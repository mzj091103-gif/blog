import { createRemoteJWKSet, jwtVerify } from 'jose';
const keySets = new Map();
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export async function authenticate(request, env, resolveKey) {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD || !env.ACCESS_ALLOWED_EMAILS?.trim()) {
    throw new HttpError(503, '网站登录尚未配置完成，请联系管理员。');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new HttpError(401, '登录已失效，请重新登录。');
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let key = resolveKey;
  if (!key) {
    if (!keySets.has(issuer)) keySets.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }));
    key = keySets.get(issuer);
  }
  let email;
  try {
    const { payload } = await jwtVerify(token, key, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'] });
    if (typeof payload.email !== 'string' || payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw new Error('Invalid identity');
    email = payload.email.toLowerCase();
  } catch { throw new HttpError(401, '登录已失效，请重新登录。'); }
  if (!env.ACCESS_ALLOWED_EMAILS.split(',').map(x => x.trim().toLowerCase()).includes(email)) throw new HttpError(403, '当前邮箱没有访问这个工作空间的权限。');
  return { email };
}
