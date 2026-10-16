import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
fs.mkdirSync(new URL('backups/', root), { recursive: true });
const output = fileURLToPath(new URL(`backups/tradeflow-${new Date().toISOString().replaceAll(':', '-')}.sql`, root));
// Wrangler prints a temporary signed download URL. Keep that URL out of shared terminal logs.
const result = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root)), 'd1', 'export', 'tradeflow', '--remote', '--config', 'wrangler.generated.json', '--output', output], { cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (!process.exitCode) console.log('数据库备份已写入 backups/。该目录不会被 Git 提交。');
else console.error((result.stderr || result.stdout || '备份失败，请检查 Cloudflare 授权。').replace(/https?:\/\/\S+/g, '[URL hidden]'));
