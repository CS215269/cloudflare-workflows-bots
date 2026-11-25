# AGENTS.md — cloudflare-workflows-bots 工作上下文

> 给 AI 编码助手与后续会话的上下文说明。仓库结构、命令与部署步骤见 [README.md](./README.md)。

## 项目目标

一个 Cloudflare Workers Workflows 机器人合集。**每个 bot 是独立 Worker**，独立部署、独立回滚、独立配置机密，
一个 bot 挂掉不影响其它 bot。

当前只有 `bots/weather-bot`：每天两次把天气播报到飞书群（早 07:35 播今天，晚 21:35 播明天，北京时间）。

## 关键决策（含理由）

| 决策 | 理由 |
|---|---|
| 用**单条** cron `35 13,23 * * *`，而不是两条 | Workers Free 计划 Cron Triggers 只有 **5 条/账号**。官方把 `*/45 * * * *`（每小时触发两次）记为**一条** trigger，说明额度按表达式条数计而非触发时刻数，合并后只占 1 条 |
| 播报模式按 **UTC 小时映射表**判定，不靠 `event.cron` | 合并成一条表达式后 `event.cron` 不再区分早晚，只能靠小时判定；原先硬编码的 `hour === 13` 是隐患，改时间就会静默出错 |
| Workflow 基类用 `WorkflowEntrypoint<Env, Params>` | Cloudflare 已把 `Workflow` 更名为 `WorkflowEntrypoint`（官方 Workers API 文档，2026-11 更新）。旧名在现行 `cloudflare:workers` 里已无导出 |
| `@cloudflare/workers-types` 锁 v5（`^5.20261124.1`） | v4 与 wrangler 4.167 的 peerOptional `^5.20261123.1` 冲突，`npm install` 直接 ERESOLVE 失败 |
| tsconfig 拆成 `tsconfig.json` + `tsconfig.scripts.json` | `src/` 跑在 Workers 运行时、`scripts/` 跑在 Node；混在同一个 program 里 URL / Buffer 类型互相冲突 |
| **不需要付费计划** | Workflows 已包含在 Workers Free 计划内（官方定价页 FAQ：Are Workflows available on the Workers Free plan? → Yes）。唯一硬约束是 10 ms CPU / 每次调用 |
| 每个 Workflow step 各自是独立调用 | 所以每个 step 各有 10 ms CPU 预算，而不是整个 Workflow 共用 10 ms |
| 和风天气 JWT **不发 `iss`**，项目ID 放 `sub` | 官方文档说 `iss`=开发者ID 且必填，但官方 Android SDK V5.2.2 的 `JWTGenerator` 字节码实际只拼 `{"alg":"EdDSA","kid":..}` + `{"sub":<项目ID>,"iat":..,"exp":..}`，无 `iss`，且该实现在真实 App 中验证可用 → 以可用实现为准，`QWEATHER_DEV_ID` 默认留空 |

## 实测数据（用于判断改动是否安全）

- 纯 CPU：aggregate ≈ 0.5 ms、渲染飞书卡片 + HMAC 签名 ≈ 2.3 ms（最重的一步）
- 响应体：open-meteo 6.2 KB（解析 ≈ 0.03 ms）、wttr.in 39 KB（解析 ≈ 0.09 ms）
- 账号额度占用：Workers 1/100、Cron Triggers 1/5、Workflow Steps 10/3000/天、请求约 2/100000/天

## 当前状态

**已完成**

- 代码实现：和风天气 / Open-Meteo / wttr.in 多源采集 → 聚合交叉校验 → 飞书卡片 → Workflow 编排
- 4 个阻塞 bug 修复：`WorkflowEntrypoint` 改名、workers-types 升 v5、tsconfig 拆分、`Uint8Array<ArrayBuffer>` 泛型
- `npm run typecheck` —— src 与 scripts 两个 project 全绿
- `npm run preview` —— 35/35 通过（离线，不需要网络 / 账号 / 密钥）
- 和风天气 JWT 3 处 401 bug 修复：`alg` 从 `ED25519` → `EdDSA`、项目ID 从 `iss` → `sub`、`iat` 提前 30s；新增 `QWEATHER_DEV_ID`（iss，默认**不填不发**）
- 新增 `npm run verify:qweather`：用真实凭据打真实 API，按「不带 iss → 带开发者ID → iss=项目ID」顺序试，实测 `iss` 到底要不要
- monorepo 骨架（npm workspaces）+ git 初始化，remote 已指向 GitHub 仓库，**已 push**

**未完成**（都需要用户凭据或交互，AI 无法代劳）

- [x] ~~`git push -u origin main`~~ 已完成
- [ ] 选择部署方式（二选一）：
  - **Workers Builds（网页）**：后台 Import a Git repository → Root directory 留空、Build `npm ci`、Deploy `npm run deploy:weather`。授权范围只有这一个 GitHub 仓库，比 wrangler 的账号级权限更窄
  - **本地 wrangler**：`npx wrangler login` + `npx wrangler deploy`
- [ ] 配置机密：`FEISHU_WEBHOOK_URL`（必填）/ `FEISHU_SECRET`（开了签名校验才要）/ 和风天气用 `QWEATHER_API_KEY`，或用 JWT 的 4 个值（`PROJECT_ID` / `KID` / `PRIVATE_KEY` / `HOST`，`DEV_ID` 可选）
- [ ] 先跑 `npm run verify:qweather` 确认鉴权通过，再部署（能省掉"部署完才发现 401"）
- [ ] 部署 → Worker 名 `myweather-bot`，地址 `myweather-bot.cs215269.workers.dev`
- [ ] 云端冒烟：`/health`、`/preview?mode=today`、`POST /trigger?mode=today`、`wrangler tail`
- [ ] 决定 `workflows-starter-template` 是否删除（目前仍在线上，**不占 cron 额度**，可留作 Workflows 试验田）

## 部署后必须验证的 6 件事（离线覆盖不到）

1. 打包能否通过（esbuild）
2. `[[workflows]]` 绑定能否在真实运行时 create 实例
3. `WorkflowEntrypoint` 的真实运行时行为（已对齐官方文档，但没实跑过）
4. Cron 是否在 UTC 整分钟准确触发
5. 飞书 webhook 真实往返与签名校验（`code: 19001` 那类坑）
6. 和风天气真实鉴权（JWT 或 API Key 任一路径）

## 改播报时间时必须同步的地方

改 `bots/weather-bot/wrangler.toml` 的 `[triggers].crons` 时，**必须**同步
`bots/weather-bot/src/lib/schedule.ts` 的 `BROADCAST_CRON` 与 `MODE_BY_UTC_HOUR`：

| 晚间北京时间 | UTC 小时 | `BROADCAST_CRON` | `MODE_BY_UTC_HOUR` 的键 |
|---|---|---|---|
| 07:35（早播，北京次日） | 23 | `"35 13,23 * * *"` | `23 → "today"` |
| 19:35 | 11 | `"35 11,23 * * *"` | `11 → "tomorrow"` |
| **21:35** | **13** | **`"35 13,23 * * *"`** | `13 → "tomorrow"` |
| 22:35 | 14 | `"35 14,23 * * *"` | `14 → "tomorrow"` |

> ⚠️ **不要用 `*/12`**：`35 */12 * * *` 是 UTC 0:35 / 12:35，即北京时间 08:35 / 20:35，不是想要的 07:35。
> ⚠️ 不要用小时区间（如 `11-15`）：那是每小时触发一次，一天会播 5 次。

## 工具链注意事项

- Node ≥ 22.6（自带 TypeScript 类型剥离，可 `node scripts/preview.ts` 直接跑，无需装依赖）
- 本环境 PowerShell 的 `Invoke-WebRequest` TLS 握手失败，但 node 的 `fetch` 正常 —— 网络探测用 node
- 受限沙箱里 npm 的默认 cache（`%LOCALAPPDATA%\npm-cache`）不可写 → `npm install --cache ./.npm-cache`
- esbuild / workerd 需要 spawn 子进程，受限环境会 `spawn EPERM` → `wrangler dev` / `wrangler deploy` 需在正常环境执行
- git 提交信息含双引号时用 `-F <file>`，不要用 `-m "..."`（PowerShell 不认反斜杠转义，会把引号当参数分隔）
- 新增 bot 的约定：机密只走 `wrangler secret put` / `.dev.vars`；**Cron Triggers 是 5 条/账号，不是每个 Worker 5 条**
