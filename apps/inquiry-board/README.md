# TradeFlow 团队询盘看板

轻量团队版：原生 HTML/CSS/JavaScript + Cloudflare Workers + D1（SQLite）+ Cloudflare Access。GitHub 保存源码；网站和真实客户数据运行在 Cloudflare。无需保持本地电脑开机。

目标域名为 `test.xqzxmarxismclub.com`。本目录位于仓库的 `apps/inquiry-board`，不修改博客根目录的 `index.html` 或 `CNAME`。生产数据库初始为空；测试中的客户全部虚构。请勿将客户数据、备份、令牌或实际登录配置提交到公开仓库。

## 功能

- 今日、逾期、报价、寄样统计；搜索、组合筛选、排序、分页。
- 新增、编辑客户与跟进日期；负责人可自由输入。
- 日期统一按 `Asia/Shanghai` 判断；成交/流失客户退出待跟进统计。
- 共享 D1 数据，页面每分钟同步，另有手动刷新。
- Access 登录 + 后端验签及邮箱白名单；所有页面、API、导出均要求登录。
- 并发版本检查，防止后一位员工无意覆盖前一位员工的修改。
- 创建请求可安全重试；同名同国家客户重复提示；服务端字段及日期校验。
- 数据库触发器原子记录每次新增/修改；详情显示最近 50 次操作。
- 网页下载 JSON 备份；管理员可以导出完整 SQL 备份。

## 目录

```text
public/              页面、样式、交互及共享业务规则
src/                 Worker API 与 Access JWT 验证
migrations/          D1 表结构与审计触发器
tests/               实际 SQLite + 签名 JWT 的集成测试
scripts/             部署配置生成、SQL 备份
wrangler.jsonc       不含账号信息的部署模板
```

## 安装与验证

安装 Node.js 24 与 pnpm 11.25.0，然后在本目录运行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

`build` 是 Wrangler 打包检查，不会发布。测试使用临时 SQLite 数据库和临时签名密钥，不连接生产数据库。测试覆盖鉴权、越权、跨站请求、数据持久化、新增重试、并发冲突、审计、备份、筛选及日期边界。浏览器验收仍须在已配置 Access 的网站上完成。

## 首次部署

1. 在 Cloudflare 创建专用 D1 数据库 `tradeflow`。已有数据库不要重复创建。
2. 在 Cloudflare Zero Trust 创建 Self-hosted Access 应用，保护完整主机名 `test.xqzxmarxismclub.com`，不限制路径。启用邮件 One-time PIN（或已配置的身份提供方）。Allow 策略仅包含管理员批准的具体邮箱，不使用 Everyone 或 Bypass。
3. 获取团队域名（`your-team.cloudflareaccess.com`）和应用 Audience（AUD）。
4. 设置下面的环境变量并生成本地配置。真实配置文件已被 Git 忽略。

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '你的账号 ID'
$env:D1_DATABASE_ID = 'tradeflow 数据库 ID'
$env:ACCESS_TEAM_DOMAIN = 'your-team.cloudflareaccess.com'
$env:ACCESS_AUD = '应用的 AUD'
$env:ACCESS_ALLOWED_EMAILS = 'owner@example.com'
pnpm configure
pnpm exec wrangler login
pnpm migrate
pnpm deploy
```

Workers Custom Domain 会管理子域名路由与证书。发布前检查该子域名没有需要保留的其他服务；不要修改主域名的博客配置。登录配置缺失时程序拒绝访问，不能把不完整部署当作可用网站。

部署后用未登录窗口确认页面及 `/api/customers` 受保护，再用批准邮箱验收新增、编辑、刷新、筛选和导出。邮件登录验证码直接输入 Cloudflare 登录页。

## 日常维护

- **新增员工**：同时更新 Access Allow 策略和 Worker 的 `ACCESS_ALLOWED_EMAILS`，重新部署。所有获准员工当前共享全部客户及导出能力，没有按负责人分权。
- **离职停用**：从两处删除邮箱并撤销 Access 会话；同步重新部署后，后端会拒绝已删除邮箱的旧 JWT。
- **修改冲突**：复制需要保留的输入，关闭详情，刷新客户列表后重新编辑；系统不会静默覆盖别人已经保存的版本。
- **备份**：网页登录后点击“下载数据备份”；管理员可运行 `pnpm backup` 导出 `backups/` 下的 SQL。备份含客户资料，应存放在公司受控位置。该版本没有自动定时备份或网页一键恢复。
- **恢复**：先在独立 D1 数据库验证 SQL 备份，然后切换数据库绑定并核对记录数量/审计；不要直接覆盖当前生产库。恢复操作应由管理员执行。
- **更新**：先测试及打包，再迁移、部署。不要修改已经执行过的迁移；新增编号迁移。数据库变更前备份。Worker 回滚不会自动回滚数据库。

## GitHub 自动部署（可选）

仓库工作流默认只验证测试及打包。开启自动部署前，在 GitHub Actions 配置：

- Secret：`CLOUDFLARE_API_TOKEN`（仅授予部署所需账号/域名权限，勿使用 Global API Key）；`ACCESS_ALLOWED_EMAILS`。
- Variables：`CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`。
- 最后把 Variable `TRADEFLOW_DEPLOY_ENABLED` 设为 `true`，才会在 main 分支提交或手动运行时迁移并发布。

本地 Wrangler OAuth 授权不会自动成为 GitHub Actions 的授权。公共仓库的工作流不会上传数据库备份或真实客户数据为构建产物。

## 当前范围

适用于少量员工、较小客户列表的共享工具。暂无角色权限、批量导入、客户删除、附件、自动消息、平台 API、自动备份恢复和大数据量服务端分页。当前列表整表读取；规模增长时再增加服务端分页与索引。运行依赖 Cloudflare 和域名续费状态，配额/套餐以账号控制台为准。

官方参考：[Access 应用](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) · [Workers 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [D1](https://developers.cloudflare.com/d1/)
