import '../public/domain.js';
import { authenticate, HttpError } from './auth.mjs';
const D = globalThis.InquiryDomain;
const columns = ['name', 'country', 'source', 'product', 'contact', 'stage', 'owner', 'last_contact', 'next_follow_up', 'notes'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function customer(row) {
  return { id: row.id, ...Object.fromEntries(D.FIELDS.map((key, i) => [key, row[columns[i]]])), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by };
}
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } }); }
function secure(response) {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries({
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  })) result.headers.set(key, value);
  return result;
}
async function readBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, '请使用 JSON 格式提交。');
  if (+request.headers.get('content-length') > 16384) throw new HttpError(413, '提交内容过大。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '提交内容为空。');
  const chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new HttpError(413, '提交内容过大。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'JSON 格式错误。'); }
}
function recordFrom(body, today) {
  let value;
  try { value = D.clean(body.customer); } catch (e) { throw new HttpError(400, e.message); }
  const error = D.validate(value, { today });
  if (error) throw new HttpError(400, error);
  return value;
}
export function createWorker({ resolveKey } = {}) {
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        if (!env.APP_ORIGIN || url.origin !== env.APP_ORIGIN) throw new HttpError(403, '请使用公司指定的网站地址。');
        const user = await authenticate(request, env, resolveKey);
        const zone = env.BUSINESS_TIMEZONE || 'Asia/Shanghai';
        const today = D.localDate(new Date(), zone);
        if (!url.pathname.startsWith('/api/')) {
          if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '不支持的请求方法。');
          return secure(await env.ASSETS.fetch(request));
        }
        if (!env.DB) throw new HttpError(503, '数据库尚未配置。');
        if (!['GET', 'POST', 'PUT'].includes(request.method)) throw new HttpError(405, '不支持的请求方法。');
        if (request.method !== 'GET' && request.headers.get('Origin') !== env.APP_ORIGIN) throw new HttpError(403, '请求来源验证失败，请在公司网站中操作。');
        const db = env.DB;
        if (url.pathname === '/api/session' && request.method === 'GET') return secure(json({ user, today, timezone: zone }));
        if (url.pathname === '/api/customers' && request.method === 'GET') {
          const { results } = await db.prepare('SELECT * FROM customers ORDER BY created_at DESC, id').all();
          return secure(json({ customers: results.map(customer), today, timezone: zone }));
        }
        if (url.pathname === '/api/export' && request.method === 'GET') {
          // D1 batch runs transactionally, keeping the records and their audit trail at one snapshot.
          const [records, history] = await db.batch([db.prepare('SELECT * FROM customers ORDER BY id'), db.prepare('SELECT * FROM audit_log ORDER BY id')]);
          return secure(json({ version: 2, exportedAt: new Date().toISOString(), timezone: zone, customers: records.results.map(customer), history: history.results }, 200,
            { 'Content-Disposition': `attachment; filename="tradeflow-${today}.json"` }));
        }
        const historyMatch = /^\/api\/customers\/([^/]+)\/history$/.exec(url.pathname);
        if (historyMatch && request.method === 'GET') {
          if (!uuid.test(historyMatch[1])) throw new HttpError(400, '客户编号无效。');
          const { results } = await db.prepare('SELECT id, action, actor, changed_at, revision, before_json, after_json FROM audit_log WHERE customer_id = ? ORDER BY id DESC LIMIT 50').bind(historyMatch[1]).all();
          return secure(json({ history: results }));
        }
        if (url.pathname === '/api/customers' && request.method === 'POST') {
          const body = await readBody(request);
          if (!uuid.test(body.id || '') || Object.keys(body).some(k => !['id', 'customer'].includes(k))) throw new HttpError(400, '新增请求格式无效。');
          const c = recordFrom(body, today), now = new Date().toISOString();
          await db.prepare(`INSERT INTO customers (id, ${columns.join(',')}, identity_key, revision, created_at, updated_at, created_by, updated_by) VALUES (${Array(17).fill('?').join(',')}) ON CONFLICT(id) DO NOTHING`)
            .bind(body.id, ...D.FIELDS.map(k => c[k]), D.identity(c), 1, now, now, user.email, user.email).run();
          const row = await db.prepare('SELECT * FROM customers WHERE id = ?').bind(body.id).first();
          if (!row || row.created_by !== user.email || D.FIELDS.some((k, i) => c[k] !== row[columns[i]]) || row.revision !== 1) throw new HttpError(409, '该请求已保存或记录已被更新，请刷新列表检查。');
          return secure(json({ customer: customer(row) }, 201));
        }
        const match = /^\/api\/customers\/([^/]+)$/.exec(url.pathname);
        if (match && request.method === 'PUT') {
          const body = await readBody(request);
          if (!uuid.test(match[1]) || !Number.isSafeInteger(body.revision) || body.revision < 1 || Object.keys(body).some(k => !['revision', 'customer'].includes(k))) throw new HttpError(400, '修改请求格式无效。');
          const c = recordFrom(body, today), now = new Date().toISOString();
          const result = await db.prepare(`UPDATE customers SET ${columns.map(k => `${k} = ?`).join(',')}, identity_key = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`)
            .bind(...D.FIELDS.map(k => c[k]), D.identity(c), now, user.email, match[1], body.revision).run();
          if (!result.meta.changes) throw new HttpError(409, '这位客户已被其他人修改。当前输入已保留，请复制需要的内容，再关闭详情并刷新列表。');
          // Return the exact revision this operation wrote; a subsequent writer may already have advanced the row.
          return secure(json({ customer: { ...c, id: match[1], revision: body.revision + 1, updatedAt: now, updatedBy: user.email } }));
        }
        throw new HttpError(404, '接口不存在。');
      } catch (e) {
        if (e instanceof HttpError) return secure(json({ error: e.message }, e.status));
        if (/UNIQUE constraint failed: customers\.identity_key/i.test(e.message || '')) return secure(json({ error: '已存在同名同国家的客户，请先检查现有记录。' }, 409));
        // Never expose SQL, tokens, customer fields, or raw runtime errors in responses/logs.
        return secure(json({ error: '服务暂时不可用，修改尚未确认保存。请稍后重试或联系管理员。' }, 503));
      }
    }
  };
}
export default createWorker();
