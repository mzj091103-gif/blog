import fs from 'node:fs';
const checks = {
  CLOUDFLARE_ACCOUNT_ID: /^[a-f0-9]{32}$/,
  D1_DATABASE_ID: /^[a-f0-9-]{36}$/,
  ACCESS_TEAM_DOMAIN: /^[a-z0-9-]+\.cloudflareaccess\.com$/,
  ACCESS_AUD: /^[a-f0-9]{64}$/,
  ACCESS_ALLOWED_EMAILS: /^[^\s@,]+@[^\s@,]+\.[^\s@,]+(?:,[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/
};
for (const [name, pattern] of Object.entries(checks)) {
  if (!pattern.test(process.env[name] || '')) throw new Error(`请先正确设置环境变量 ${name}，不要将密钥写入源码。`);
}
const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
config.d1_databases[0].database_id = process.env.D1_DATABASE_ID;
for (const name of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_ALLOWED_EMAILS']) config.vars[name] = process.env[name];
fs.writeFileSync(new URL('../wrangler.generated.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
console.log('部署配置已生成。配置文件已被 Git 忽略。');
