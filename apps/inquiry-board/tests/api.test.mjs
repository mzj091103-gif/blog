import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SignJWT, generateKeyPair } from 'jose';
import { createWorker } from '../src/worker.mjs';
const D = globalThis.InquiryDomain;
const origin = 'https://test.xqzxmarxismclub.com';
let privateKey, publicKey;
before(async () => { ({ privateKey, publicKey } = await generateKeyPair('RS256')); });
async function token(options = {}) {
  return new SignJWT({ email: 'alice@example.com', ...options.claims }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(options.issuer || 'https://team.cloudflareaccess.com').setAudience(options.audience || 'app-audience')
    .setSubject('test-user').setIssuedAt().setExpirationTime(options.expiration || '1h').sign(options.key || privateKey);
}
function database(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const adapter = {
    prepare(sql) {
      let args = [];
      const prepared = {
        bind(...values) { args = values; return prepared; },
        async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) || null; }
      }; return prepared;
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.all()); db.exec('COMMIT'); return results; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
  return { db, adapter };
}
async function fixture(t, file) {
  const { db, adapter } = database(file); t.after(() => db.close());
  const env = { APP_ORIGIN: origin, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'app-audience', ACCESS_ALLOWED_EMAILS: 'alice@example.com,bob@example.com', BUSINESS_TIMEZONE: 'Asia/Shanghai', DB: adapter, ASSETS: { fetch: () => new Response('static asset') } };
  const worker = createWorker({ resolveKey: publicKey });
  const jwt = await token();
  async function request(route, { method = 'GET', body, headers = {}, auth = jwt, rawBody } = {}) {
    return worker.fetch(new Request(origin + route, { method, headers: { ...(auth ? { 'Cf-Access-Jwt-Assertion': auth } : {}), ...(body || rawBody ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...headers }, body: rawBody ?? (body ? JSON.stringify(body) : undefined) }), env);
  }
  return { request, db, env, worker };
}
function sample(overrides = {}) { return { name: 'Demo Only Ltd', country: 'UAE', source: 'Alibaba', product: 'PU Foam', contact: 'buyer@example.com', stage: '新询盘', owner: 'Alice', lastContact: '', nextFollowUp: D.localDate(), notes: 'Test fixture only', ...overrides }; }
test('all assets, API reads, writes, history and exports require a signed Access token', async t => {
  const { request } = await fixture(t);
  for (const route of ['/', '/app.js', '/api/session', '/api/customers', '/api/export', '/api/customers/' + crypto.randomUUID() + '/history']) {
    assert.equal((await request(route, { auth: null, headers: { 'Cf-Access-Authenticated-User-Email': 'alice@example.com' } })).status, 401, route);
  }
  assert.equal((await request('/api/customers', { method: 'POST', auth: null, body: { id: crypto.randomUUID(), customer: sample() } })).status, 401);
});
test('wrong audience, issuer, signature, expiry, or unapproved email is rejected', async t => {
  const { request } = await fixture(t);
  const wrong = await generateKeyPair('RS256');
  for (const config of [{ audience: 'other-app' }, { issuer: 'https://attacker.example.com' }, { expiration: '1 second ago' }, { key: wrong.privateKey }, { claims: { email: null } }]) {
    assert.equal((await request('/api/customers', { auth: await token(config) })).status, 401);
  }
  assert.equal((await request('/api/customers', { auth: await token({ claims: { email: 'outsider@example.com' } }) })).status, 403);
});
test('missing configuration fails closed and alternate hostnames cannot bypass login', async t => {
  const { request, env, worker } = await fixture(t);
  const originRequest = new Request('https://other.workers.dev/api/customers');
  assert.equal((await worker.fetch(originRequest, env)).status, 403);
  env.ACCESS_AUD = '';
  assert.equal((await request('/api/customers')).status, 503);
});
test('production database starts empty; create, read, edit, audit and export share stored records', async t => {
  const { request } = await fixture(t);
  assert.deepEqual((await (await request('/api/customers')).json()).customers, []);
  const id = crypto.randomUUID();
  const created = await request('/api/customers', { method: 'POST', body: { id, customer: sample() } });
  assert.equal(created.status, 201);
  const first = (await created.json()).customer;
  assert.equal(first.revision, 1); assert.equal(first.updatedBy, 'alice@example.com');
  const edited = await request('/api/customers/' + id, { method: 'PUT', body: { revision: 1, customer: sample({ stage: '已成交', notes: 'Order confirmed' }) } });
  assert.equal(edited.status, 200);
  const list = await (await request('/api/customers')).json();
  assert.equal(list.customers[0].stage, '已成交'); assert.equal(list.customers[0].revision, 2);
  assert.equal(D.stats(list.customers, list.today).today, 0);
  const history = (await (await request('/api/customers/' + id + '/history')).json()).history;
  assert.equal(history.length, 2); assert.equal(JSON.parse(history[0].before_json).stage, '新询盘');
  const exported = await request('/api/export');
  assert.match(exported.headers.get('Content-Disposition'), /attachment/);
  const backup = await exported.json(); assert.equal(backup.customers.length, 1); assert.equal(backup.history.length, 2);
});
test('competing edits reject one stale revision and failed writes create no audit records', async t => {
  const { request } = await fixture(t), id = crypto.randomUUID();
  await request('/api/customers', { method: 'POST', body: { id, customer: sample() } });
  const writes = await Promise.all(['First', 'Second'].map(notes => request('/api/customers/' + id, { method: 'PUT', body: { revision: 1, customer: sample({ notes }) } })));
  assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]);
  const history = (await (await request('/api/customers/' + id + '/history')).json()).history;
  assert.equal(history.length, 2);
});
test('retrying a create is idempotent and normalized duplicate companies are rejected', async t => {
  const { request } = await fixture(t), id = crypto.randomUUID(), body = { id, customer: sample() };
  assert.equal((await request('/api/customers', { method: 'POST', body })).status, 201);
  assert.equal((await request('/api/customers', { method: 'POST', body })).status, 201);
  assert.equal((await request('/api/customers', { method: 'POST', body: { id: crypto.randomUUID(), customer: sample({ name: ' ＤＥＭＯ   ONLY Ltd ', country: ' uae ' }) } })).status, 409);
  assert.equal((await (await request('/api/customers')).json()).customers.length, 1);
  assert.equal((await (await request('/api/customers/' + id + '/history')).json()).history.length, 1);
});
test('cross-origin, oversized, malformed and invalid-date writes are rejected without changing data', async t => {
  const { request } = await fixture(t), body = { id: crypto.randomUUID(), customer: sample() };
  assert.equal((await request('/api/customers', { method: 'POST', body, headers: { Origin: 'https://attacker.example.com' } })).status, 403);
  assert.equal((await request('/api/customers', { method: 'POST', rawBody: '{bad' })).status, 400);
  assert.equal((await request('/api/customers', { method: 'POST', rawBody: 'x'.repeat(17000) })).status, 413);
  for (const updates of [{ nextFollowUp: '2026-02-30' }, { lastContact: '9999-01-01' }, { stage: 'fake' }, { owner: '' }, { notes: 'x'.repeat(2001) }, { unexpected: 'value' }]) {
    assert.equal((await request('/api/customers', { method: 'POST', body: { ...body, customer: sample(updates) } })).status, 400);
  }
  assert.equal((await (await request('/api/customers')).json()).customers.length, 0);
});
test('SQL input stays literal, database errors are sanitized, and responses cannot be cached', async t => {
  const { request, env } = await fixture(t);
  const response = await request('/api/customers', { method: 'POST', body: { id: crypto.randomUUID(), customer: sample({ name: "Demo'); DROP TABLE customers; --" }) } });
  assert.equal(response.status, 201);
  assert.equal((await (await request('/api/customers')).json()).customers.length, 1);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  env.DB = { prepare() { throw new Error('Sensitive database diagnostics'); } };
  const failed = await request('/api/customers');
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /Sensitive/);
});
test('database files preserve edits across a backend restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tradeflow-test-'));
  const file = path.join(directory, 'fixture.sqlite');
  let first, second;
  try {
    first = database(file);
    const worker = createWorker({ resolveKey: publicKey });
    const env = { APP_ORIGIN: origin, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'app-audience', ACCESS_ALLOWED_EMAILS: 'alice@example.com', DB: first.adapter };
    const response = await worker.fetch(new Request(origin + '/api/customers', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': await token() }, body: JSON.stringify({ id: crypto.randomUUID(), customer: sample() }) }), env);
    assert.equal(response.status, 201); first.db.close(); first = null;
    second = database(file);
    assert.equal((await second.adapter.prepare('SELECT * FROM customers').all()).results.length, 1);
    assert.equal((await second.adapter.prepare('SELECT * FROM audit_log').all()).results.length, 1);
  } finally { first?.db.close(); second?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('all stages, filters and company timezone boundaries remain consistent', () => {
  assert.equal(D.localDate(new Date('2026-10-15T16:00:00Z'), 'Asia/Shanghai'), '2026-10-16');
  assert.equal(D.localDate(new Date('2026-10-15T15:59:59Z'), 'Asia/Shanghai'), '2026-10-15');
  for (const stage of D.STAGES) for (const [due, expected] of [['2026-10-15', 'overdue'], ['2026-10-16', 'today'], ['2026-10-17', 'normal']]) {
    assert.equal(D.status(sample({ stage, nextFollowUp: due }), '2026-10-16'), ['已成交','已流失'].includes(stage) ? 'closed' : expected);
  }
  const list = [sample({ id: '1', owner: '真实负责人', stage: '已报价' }), sample({ id: '2', country: 'Germany', source: 'Google' })];
  assert.equal(D.filterCustomers(list, { query: 'ＰＵ FOAM', stage: '已报价', country: 'uae', owner: '真实负责人', source: 'Alibaba' }).length, 1);
  assert.equal(D.validDate('2024-02-29'), true); assert.equal(D.validDate('2026-02-29'), false);
});
