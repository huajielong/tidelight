# 潮光 · TIDELIGHT

驾驶一叶灯舟，在月落前收集湿地里的萤火、维持连击，并避开追逐光芒的影涡。每局 **75 秒、3 点灯火**。原生 HTML/CSS/Canvas/JavaScript ESM，前端无第三方运行时依赖；Netlify 云端使用官方数据库依赖。

## 公开部署与开源

采用 [MIT 许可证](LICENSE)。Netlify 部署步骤、服务端密钥、公开访问、每日/月调用配额和费用边界见 [DEPLOYMENT.md](DEPLOYMENT.md)。复现开发过程见 [协作指南](浏览器游戏协作复现指南.md)。

公开仓库：[huajielong/tidelight](https://github.com/huajielong/tidelight)。2026-10-19 发布状态：GitHub 已开源；Netlify 已创建项目，但 CLI 无法访问该项目，线上部署和匿名访问验收尚未完成。

下文 `.logs/` 是原作者本机的历史验证记录，默认不随公开仓库发布；可复用浏览器脚本已迁移至 `scripts/browser/`。

## 运行

需要 Node.js 22 或更新版本。在仓库目录运行：

```powershell
node scripts/serve.mjs
```

打开 <http://localhost:4173/>。无需安装 npm 包或执行构建。指定其他端口可使用 `node scripts/serve.mjs --port 4317`，然后打开 <http://127.0.0.1:4317/>。在终端按 Ctrl+C 停止服务。不要直接双击 `index.html`；游玩时需保持服务终端运行。

## 操作和规则

| 操作 | 键盘 | 鼠标 / 触屏 |
| --- | --- | --- |
| 引航 | WASD / 方向键 | 按住水面拖动，松手停止引航 |
| 流光冲刺 | Space | 点击「冲刺」按钮 |
| 暂停 / 继续 | P / Esc | 暂停 / 继续按钮 |
| 静音 / 取消静音 | M | 声音按钮 |
| 开始 / 重开 | Enter | 启航 / 再航一夜按钮 |

- 普通青色萤火基础分 100，金色萤火 250；金色只加分，不延长单局时间。
- 连续收集保持 2.5 秒连击窗口，倍率每三次连击提升一级，最高 ×5。超时或受击中断连击。
- 冲刺持续 0.22 秒、速度为常规的 1.9 倍，冷却 2.4 秒；**冲刺不提供无敌**。
- 受击损失一条生命并获得 1.2 秒保护；虚线光环表示保护期间。影涡的实线外圈标示碰撞边界。
- 生命耗尽或 75 秒结束后结算；最高分仅保存在当前浏览器中。存储不可用时仍可游玩。
- 窗口失焦或切换标签页自动暂停，返回后需手动继续。
- 横屏体验最佳。竖屏完整显示 16:9 世界，HUD 与触摸按钮仍可使用。

支持键盘焦点、DOM 状态播报、减少动态效果和增强对比度。仅游戏水面禁用拖动滚屏。音频仅在用户交互后启用，禁用音频不会影响玩法。

## AI 玩法（v1.2）

1. **潮汐导演（本地行为逻辑）**：根据位置、连击、停留和受击情况，在第 12 / 26 / 42 / 60 秒预告航路、试炼、喘息或归潮。水纹预告 1.8 秒后生效；受伤后可触发额外喘息，减慢敌人并暂停新敌人加入。连击奖励改变路线，不额外暗中提高追逐速度。
2. **三种影涡**：圆心追光者持续追逐；三角伏潮者提前 1.5 秒锁定方向和行程，再直线突进，之后休息；菱形守灯者围绕金色萤火巡游。新出现的影涡有 1.8 秒虚线预告，期间不会造成碰撞伤害。形状、颜色、动作和音效共同传达危险。
3. **一句话挑战**：输入最多 200 字，生成并预览难度、主题、敌人组合、路线、四次潮汐及种子，再点击「用此挑战启航」。可收藏最多 8 个挑战、导出/导入 `TL1.` 挑战码。重开保留种子；「换个种子」保留规则并改变布局。同配置、同种子、同操作在当前规则版本可复现。最高分仍为当前浏览器的所有挑战总纪录，不是跨难度排行榜。

生成在开局前完成，游戏中没有模型请求。标题页可以直接开始默认挑战；暂停或结算后点击「更换挑战」返回编辑。收藏仅在本机浏览器保存，挑战码不包含输入原文、密钥或可执行代码。

### 接入 DeepSeek / 字节 Seed（可选）

没有密钥也可完整游玩；界面会明确标注「本地关键词」，只识别新手/困难、极光/暖色、环形、金色、排除某种影涡等有限偏好，**不是大模型**。

通过服务端环境变量 `AI_PROVIDER` 选择一家平台；只有选中的平台会收到挑战描述。**不会在 DeepSeek / Seed / OpenAI 之间自动切换**，失败只回退本地关键词。不要将密钥写入前端代码或粘贴到聊天。

| `AI_PROVIDER` | 必填密钥 | 模型配置 | 输出方式 |
| --- | --- | --- | --- |
| `deepseek`（默认） | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL=deepseek-flash`，可覆盖为账户可用的兼容模型 | Chat Completions JSON 模式 + 双端规则校验 |
| `seed` | `ARK_API_KEY` | 必填 `ARK_MODEL`：火山方舟的 Seed Model ID 或 `ep-...` 接入点 ID | Chat Completions 严格 JSON Schema 子集 + 双端规则校验 |
| `openai`（保留兼容） | `OPENAI_API_KEY` | `OPENAI_MODEL=gpt-5-mini` | Responses 严格 JSON Schema |
| `local` | 无 | 无 | 只用本地关键词，不请求模型 |

Seed 当前对接国内火山方舟北京区官方接口；不是 BytePlus 国际版、Coding Plan 专用接口或第三方中转。请在方舟控制台选用已开通且支持 `json_schema` 和 `thinking: disabled` 的 Seed 模型或接入点，不要填写网页产品名称或 URL。官方示例目前使用 `doubao-seed-2-1-pro-260915`，但本项目不默认指定 Seed 版本，避免假定你的账户权限。参考 [方舟结构化输出与支持范围](https://console.volcengine.com/ark/region:cn-beijing/docs/structured-output-beta) 和 [Chat API](https://console.volcengine.com/ark/region:cn-beijing/docs/chat-api)。

DeepSeek 默认模型和 JSON 请求方式依据 [官方 JSON 模式文档](https://api-docs.deepseek.com/guides/json_mode/)；两家请求均关闭深度思考，以控制开局等待时间。模型名称与权限可能变化，可通过对应模型变量调整。仅配置旧的 `OPENAI_API_KEY` 不会调用 OpenAI，必须显式设置 `AI_PROVIDER=openai`。

推荐使用 **Node.js 22+** 的环境文件方式：复制 `.env.example` 为 `.env.local`，在本机编辑器中选择平台、填入该平台密钥及模型，然后运行：

```powershell
node --env-file=.env.local scripts/serve.mjs --port 4317
```

如果保存的文件名是 `.env`（本机目前使用此名称），将上述参数改为 `--env-file=.env`：

```powershell
node --env-file=.env scripts/serve.mjs --port 4317
```

普通启动命令不会自动加载 `.env` 或 `.env.local`。修改配置后需重启服务；若使用系统环境变量，需在读取到变量的新终端里重启。`.env` / `.env.*` 已被 Git 忽略，只有无密钥的 `.env.example` 例外。不要将填写后的环境文件上传或提交。

刷新游戏后，「DeepSeek / Seed · 已配置」只表示必填配置存在，**不代表认证、权限或余额已验证**；生成结果的来源标签显示对应平台才表示该次响应成功并通过校验。缺失配置、认证失败、模型无权限、限流、拒绝、超时或格式不合法时会说明原因并回退本地规则，仍然能开局。

- `GET /api/challenge/status`：返回所选平台、模型 ID、配置状态及安全提示，不返回密钥。
- `POST /api/challenge`：`{ "prompt": "新手练习，极光水面" }`；返回已校验 challenge、source、notice。
- 接口仅监听 `127.0.0.1`，校验 Host 与同源来源；每次最多 4 KB / 200 字，每分钟最多 5 次生成、同时最多 1 次。模型请求超时 20 秒。没有遥测和请求内容日志。
- 服务只公开 HTML/CSS、`src/` 与美术资源，不公开环境文件、Git、日志或服务端源文件。这是本地开发服务器，不应直接暴露到公网；公开部署使用单独的 Netlify Functions 和持久化配额，详见 `DEPLOYMENT.md`。
- 两家使用固定官方 HTTPS 地址，不允许浏览器指定地址/密钥/模型。Seed 请求只使用其文档列出的 Schema 关键字；长度、数值范围、事件数量、敌人唯一性仍在双端验证。DeepSeek 的合法 JSON 也不等于合法关卡，必须通过同一规则检查。
- 远程平台会处理输入描述，**不承诺零数据保留**，请勿输入敏感信息。保留的 OpenAI 分支才使用 Responses `store: false`；此参数不发送给 DeepSeek / Seed。

当前验收：本地全流程和三家平台的模拟成功/失败分支已通过。2026-10-19 已使用用户本机 `.env` 完成一次真实 DeepSeek（`deepseek-flash`）调用，生成结果通过双端校验，预览、开局和同种子重玩正常。Seed 仍只有模拟验证，真实联调需对应密钥和模型 ID。单次成功不代表所有模型/网络条件均已验证；脱敏记录见 `.logs/deepseek-live.md`。

## 验证

```powershell
node --test
node scripts/check.mjs
node scripts/build.mjs
```

构建是可选的，会在 `dist/` 内输出可静态托管的页面、代码和美术资源。`dist/` 是构建产物目录，重新构建会替换其中内容。纯静态托管只能使用本地关键词生成；远程模型需要本仓库 Node 服务或随仓库提供的 Netlify Functions，密钥和服务代码不会进入 `dist/`。

当前通过 **62 项 Node 测试**；此前浏览器回归通过 **111 项断言**，覆盖核心玩法、真实键盘/鼠标/触摸、多视口和模型适配。模型成功/失败分支使用模拟响应；真实本地 HTTP 回退另行验证。测试边界见 `.logs/model-providers.md`。浏览器复测需要已安装 Playwright CLI 及可用浏览器；本机使用 Microsoft Edge：

```powershell
playwright-cli -s=tidelight open http://localhost:4173/ --browser msedge
playwright-cli -s=tidelight run-code --filename=scripts/browser-check.js --raw
playwright-cli -s=tidelight run-code --filename=scripts/browser-extra.js --raw
playwright-cli -s=tidelight run-code --filename=scripts/browser-ai.js --raw
playwright-cli -s=tidelight run-code --filename=scripts/browser-providers.js --raw
playwright-cli -s=tidelight close
```

`playwright-interactive` 技能在此环境不可用，已根据用户选择改用 Playwright CLI。桌面 Edge 和其触摸模拟已验证；尚未在实体手机、Firefox 或 Safari 上实测，性能结果只代表当前测试环境。

## 观测与确定性测试

模块初始化完成后派发 `window` 上的 `tidelight:ready` 事件；也可等待 `window.__TIDELIGHT__` 出现。美术加载状态由 `getMetrics().assets` 单独表示，图片缺失时使用代码后备画面。

普通页面提供冻结的方法集合：

```js
window.__TIDELIGHT__.getState();   // 可序列化深拷贝：模式、时间、分数、生命、连击、收集数、玩家、实体、静音等
window.__TIDELIGHT__.getMetrics(); // 帧率、实体/特效数量、CSS/像素画布尺寸、DPR、资源与音频状态
window.__TIDELIGHT__.start();
window.__TIDELIGHT__.restart();
window.__TIDELIGHT__.pause();
window.__TIDELIGHT__.resume();
window.__TIDELIGHT__.setMuted(true);
```

显式打开 <http://localhost:4173/?test=1> 后，默认停止自动模拟，额外开放：

```js
const game = window.__TIDELIGHT__;
game.setSeed(42);
// game.setChallenge(validChallenge); // 额外验证关卡结构，并采用其种子
game.start();
game.setInput(1, 0);
game.step(1000);           // 毫秒，范围 0–120000；内部按固定逻辑步推进
game.clearInput();
game.dash();
game.loadScenario('collection'); // collection / damage / last-life / survival / empty
game.setAutoRun(true);    // 使用真实时间；手动 step 前需设回 false
```

测试场景仅用于确定性规则验证，不能代替实际控件验证；主浏览器脚本同时覆盖两条路径。普通页面（包括 `?test=0`）没有步进、种子或输入注入方法。测试局不会写入个人最高分。

## 文件和美术

- `PLAN.md`：需求、验收和里程碑。
- `src/config.js`：集中数值与资源预算。
- `src/core.js`：可独立测试的固定步长模拟。
- `src/main.js`：输入、状态、HUD、测试接口和循环。
- `src/director.js`：自适应潮汐与三类影涡行为。
- `src/challenge.js` / `src/challenge-panel.js`：严格关卡契约、本地规则、挑战码、预览和收藏。
- `scripts/ai-provider.mjs`：平台配置、DeepSeek / Seed / OpenAI 请求与响应适配。
- `scripts/challenge-api.mjs`：服务端生成接口、限流、严格验证和回退。
- `src/renderer.js` / `src/audio.js`：绘制与可选合成音效。
- `assets/moonlit-lagoon.png`：保留的月光湿地背景。
- `assets/lantern-boat.png`：本次使用内置 ImageGen 新生成的透明灯舟。
- `.logs/development.md`：工作、验证与已知限制；截图、浏览器脚本和各阶段日志在同目录。
- `.logs/imagegen.md`：完整最终提示词、生成方式、保存路径和透明度检查。

基本游玩不需要模型 API 或账号。只有可选的大模型挑战生成需要本机服务端密钥与外网连接；最新联调状态见 `.logs/model-providers.md`，三项玩法实现记录见 `.logs/ai-implementation.md`。
