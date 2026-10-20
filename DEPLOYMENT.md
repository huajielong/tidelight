# 发布与维护

本项目采用 MIT 许可证。前端不依赖第三方运行时；Netlify 后端使用官方 `@netlify/database` 存储调用计数。

## 已发布演示

[潮光 TIDELIGHT 在线体验](https://tidelight-huajielong.netlify.app/)（公开，无需登录）。2026-10-20 验证首页及状态接口 HTTP 200，真实 DeepSeek 生成、开局和同种子重玩通过；环境文件、Git 配置、服务端源码及私人日志路径为 404。

项目通过 GitHub `main` 自动部署。纯文档更新可在提交信息中加入 `[skip netlify]`，避免无必要的重新构建；代码更新不能跳过上线验收。

Netlify 可能为新公开项目注入右下角徽标。本项目在徽标存在时预留底部 72px，避免挡住冲刺与可滚动界面；未隐藏徽标或改变平台权限。可复测 `scripts/browser/browser-hosting-badge.js`。若未来徽标尺寸改变，请重新检查留白；也可由项目所有者按 [官方徽标设置说明](https://docs.netlify.com/manage/projects/powered-by-netlify-badge/) 在控制台关闭它，无需修改游戏代码。

## 部署自己的版本

1. Fork 本仓库。在 Netlify 中从 GitHub 导入自己的仓库，选择 `main`；使用 Free 套餐，不需要开启付费升级。
2. `netlify.toml` 定义构建命令 `npm test && npm run check && npm run build`、Node 22、发布目录 `dist` 和 Functions 目录。安装依赖及提交的 SQL 迁移会触发 Netlify Database 配置；数据库属于平台额度消耗，不是无限免费服务。
3. 在 Netlify 的环境变量中设置 `AI_PROVIDER=deepseek`、`DEEPSEEK_MODEL=deepseek-flash`，并把自己的 `DEEPSEEK_API_KEY` 作为 **production** 的秘密变量保存。优先限定 Functions；若套餐不支持此细分范围，应先确认更广权限的风险。本项目经用户批准后实测可保存 secret + builds/functions/runtime；秘密变量不能含 post-processing，不能直接套用包含它的默认所有作用域。保存后核验名称、secret 标记、作用域和上下文，不打印密钥值。不要给变量添加 `PUBLIC_` 或 `VITE_` 前缀，不要上传整个 `.env` 或提交真实密钥。
4. 建议配置 `AI_DAILY_LIMIT=100`、`AI_MONTHLY_LIMIT=1000`。可以降低或设为 0；程序不会接受高于上述默认上限的值。环境变量变更后重新部署。
5. 首次正式部署成功后，在 Project configuration → General → Project visibility 中选择 Public。新项目可能默认 Private；部署成功不等于匿名访问已开放。
6. 匿名打开网站，检查 `/api/challenge/status`，完成一次模型生成及开局，并确认 `/.env`、`/.git/config`、`/scripts/cloud-api.mjs` 均为 404。状态“已配置”不等于真实调用成功；结果 `source=deepseek` 才是模型成功。

可使用官方 Netlify CLI 链接站点并 `netlify init` 配置 Git 自动部署。若只手动发布：先运行构建，再使用 `netlify deploy` 创建预览，确认后 `netlify deploy --prod` 正式发布。预览环境只能使用本地关键词，不会消耗正式站点模型额度。

## 配额、费用与访问边界

- 网站及生成入口公开，没有登录或邀请码。公开不代表密钥公开：浏览器永远不会收到密钥。
- `/api/challenge` 配置平台 IP + 域名限流，每分钟 5 次。平台执行可能有延迟，不是全站预算保证；跨域来源校验也不能阻止脚本伪造请求。
- 全站通过 Postgres 单条原子 UPSERT 在调用模型前预扣配额：每天最多 100 次，每月最多 1,000 次，以 Asia/Shanghai 日期计算。不同函数实例和重新部署共享正式数据库计数；跨日/月自然使用新的日期键。失败、超时也计数，不自动重试或退还。
- 数据库无法连接、配额已满、配置非法或模型失败时，不继续收费调用，返回可玩的本地关键词挑战。数据库只保存日期与数量，不保存 IP、描述原文、密钥或游戏轨迹。
- 每次输入最多 200 字 / 请求 4 KB，输出上限 2,000 tokens，模型等待 20 秒。等待超时不保证模型平台立刻停止计费。
- DeepSeek 调用由部署者的 DeepSeek 账户计费，独立于 Netlify 托管费。次数配额不是人民币金额硬上限；请同时关注平台余额和最新价格。
- Netlify Free 有团队级额度，部署、函数、数据库和带宽会消耗额度；耗尽可能暂停该团队所有站点，包括其他项目。没有自动升级或充值，不保证无限免费访问。
- 预览关闭远程生成，防止独立预览数据库分支变成另一份调用预算。更改环境上下文或克隆生产数据库后不要认为旧预算仍然适用。

## 更新、故障与紧急关闭

Git 自动部署启用后，推送 `main` 会重新构建部署。单纯修改文档也可能触发部署并消耗额度。先本地 `npm ci`、`npm test`、`npm run check`、`npm run build`。

暂时关闭收费生成：在生产环境设置 `AI_PROVIDER=local` 或 `AI_DAILY_LIMIT=0`，然后重新部署；静态游戏和本地规则仍可使用。需要立即撤销凭证时，在 DeepSeek 控制台撤销该 Key。更换 Key 后更新 Netlify 的秘密变量并部署，不要改前端。

迁移文件一经部署不可修改或删除；新增带时间戳的迁移。不要手工清空计数表来“修复”限额，否则会重置实际保护。需要提高最大配额时，应先评估费用，再修改服务端硬上限和对应测试。

日志位于本机 `.logs/`，默认不公开。可复用浏览器脚本在 `scripts/browser/`；真实 DeepSeek 脚本是主动调用入口，不要放入自动回归。

## 官方参考（2026-10-19 核验）

- [Netlify Free 定价](https://www.netlify.com/pricing/)
- [团队额度耗尽后的暂停规则](https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/)
- [Netlify 基于代码的限流](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- [DeepSeek 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
