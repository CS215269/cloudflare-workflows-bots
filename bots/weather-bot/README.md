# myweather-bot — Cloudflare Workflows 定时天气播报（飞书 Webhook）

> 本 bot 是 [`cloudflare-workflows-bots`](../../README.md) 仓库的 `bots/weather-bot/`，
> Worker 名 `myweather-bot`，线上地址 `https://myweather-bot.cs215269.workers.dev`。

每天两次自动播报天气到飞书群（**单条** cron 表达式，每 12 小时触发一次）：

| 北京时间 | 播报内容 | Cloudflare Cron（UTC） |
| --- | --- | --- |
| **07:35** | 今天的天气（实时天气 + 今日预报 + 贴心提示） | `35 13,23 * * *` 的 UTC 23:35 |
| **21:35** | 明天的天气预报（趋势 + 降水概率 + 贴心提示） | `35 13,23 * * *` 的 UTC 13:35 |

数据来自 **多个天气 API**：和风天气（QWeather）、Open-Meteo、wttr.in；聚合时以和风天气为主源，其它源补齐缺失字段并做温差交叉校验。

## 为什么是 Cloudflare Workflows

- **定时触发**：Cron Trigger 天然匹配「每天早晚各一次」。
- **多 API 调用**：Workflow 的每个采集步骤独立、可重试，一个源挂掉不影响其它源。
- **可观测/可追溯**：Workflow 实例保留每次运行的状态与日志（Dashboard → Workflows）。
- **零服务器**：Workers 按量计费，空闲不花钱。

```
Cron Trigger ──► scheduled() ──► 创建 Workflow 实例
                                     │
                  ┌──────────────────┴───────────────────┐
                  │  step: collect-qweather                │
                  │  step: collect-open-meteo              │
                  │  step: collect-wttr                    │
                  └──────────────────┬───────────────────┘
                                     ▼
                         step: aggregate（多源聚合 + 提示）
                                     ▼
                    step: push-feishu（渲染卡片 → Webhook）
```

## 目录结构

```
weather-bot/
├── wrangler.toml              # Cron、Workflow 绑定、变量
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Worker 入口：scheduled + HTTP 接口
│   ├── types.ts
│   ├── workflows/
│   │   └── weather-report.ts  # Workflow 编排（采集 → 聚合 → 推送）
│   ├── providers/
│   │   ├── qweather.ts        # 和风天气：实时天气 + 7 日预报
│   │   ├── open-meteo.ts      # Open-Meteo：免费，免 Key
│   │   └── wttr.ts            # wttr.in：兜底数据源
│   └── lib/
│       ├── aggregate.ts       # 多源聚合、贴心提示
│       ├── collect.ts         # 并发采集入口
│       ├── feishu.ts          # 飞书卡片渲染 + 签名 + 推送
│       ├── jwt.ts             # 和风天气 Ed25519 JWT
│       ├── schedule.ts        # Cron ↔ 播报模式映射
│       └── time.ts            # 时区换算（今天/明天）
└── scripts/preview.ts         # 本地自检脚本（mock 数据，无需网络）
```

## 部署步骤

```bash
# 在仓库根执行（npm workspaces）
npm install
cd bots/weather-bot

# 1) 登录 Cloudflare
npx wrangler login

# 2) 配置机密变量（敏感信息只走 secret，不写进代码）
npx wrangler secret put FEISHU_WEBHOOK_URL   # 飞书群「自定义机器人」Webhook 地址
npx wrangler secret put FEISHU_SECRET       # 若机器人开了「签名校验」才需要
npx wrangler secret put QWEATHER_API_KEY    # 和风天气 API Key（与下面 JWT 二选一）
# 或者复用 Android 端 local.properties 里的 JWT 凭据：
npx wrangler secret put QWEATHER_PROJECT_ID   # 项目ID -> JWT payload.sub
npx wrangler secret put QWEATHER_KID          # 凭据ID -> JWT header.kid
npx wrangler secret put QWEATHER_PRIVATE_KEY  # PEM 或纯 Base64 均可
npx wrangler secret put QWEATHER_HOST         # 你的专属 API Host，如 abcxyz.qweatherapi.com
npx wrangler secret put QWEATHER_DEV_ID       # 可选：开发者ID（Q 开头 10 位）-> JWT payload.iss

# 3) 按需调整城市与开关（wrangler.toml 的 [vars]）
#    CITY_ID=101010100  CITY_NAME=北京  LAT=39.9042  LON=116.4074
#    ENABLE_QWEATHER=1  ENABLE_OPEN_METEO=1  ENABLE_WTTR=0

# 4) 部署
npx wrangler deploy
```

### 和风天气 JWT 认证要点

JWT 需要 **4 个值**（常被误称为「三件套」）：

| 值 | 环境变量 | 写进 JWT 的位置 | 在哪拿 |
|---|---|---|---|
| 项目ID | `QWEATHER_PROJECT_ID` | `payload.sub` | 控制台 → 项目管理 |
| 凭据ID | `QWEATHER_KID` | `header.kid` | 控制台 → 项目管理 → 凭据 |
| Ed25519 私钥 | `QWEATHER_PRIVATE_KEY` | 用于签名 | 本地生成；公钥需上传到控制台 |
| API Host | `QWEATHER_HOST` | 请求域名 | 控制台 → 设置 |
| 开发者ID（可选） | `QWEATHER_DEV_ID` | `payload.iss` | 控制台 → 设置 |

两个最常见的坑（写错直接 401）：

- `header.alg` 必须是 **`EdDSA`**，不是 `ED25519` —— 后者是算法名，不是 JOSE 的 `alg` 取值
- **项目ID 放 `sub`**，`iss` 是另一个值（开发者ID），两者不能混用

`iss` 是否必填视账号而定，用下面的 `npm run verify:qweather` 实测即可（会分别试「带 iss / 不带 iss / iss=项目ID」三组，看哪组返回 `code=200`）。

> 提示：**Workers Workflows 已包含在 Workers Free 与 Paid 计划中**，无需付费订阅即可部署 `[[workflows]]` 绑定（官方定价页 FAQ：Are Workflows available on the Workers Free plan? → Yes）。
> 免费计划的唯一硬约束是 **CPU 时间 10 ms / 每次调用**（本项目每个 Workflow step 各自是一次独立调用，因此每个 step 各有 10 ms 预算）。
> 实测纯 CPU 开销：aggregate ≈ 0.5 ms、渲染飞书卡片+HMAC 签名 ≈ 2.3 ms、open-meteo 响应体 6.2 KB 解析 ≈ 0.03 ms、wttr.in 响应体 39 KB 解析 ≈ 0.09 ms —— 均在 10 ms 以内，且等待网络 I/O 不计入 CPU。
> 若将来 payload 变大或 step 变重，Free 计划无法通过 `limits.cpu_ms` 调高上限（该配置仅 Paid 可用），只能优化代码；届时再考虑升级。

## 验证

```bash
# 类型检查（src 与 scripts 两个 project 都检查）
npm run typecheck

# 本地自检：mock 数据跑通 采集→聚合→渲染，含时间换算 / Cron 映射 / 飞书签名 / JWT 断言
# 只需 Node ≥ 22.6，无需装依赖、无需网络、无需 Cloudflare 账号
node scripts/preview.ts

# 真实鉴权自检：用 .dev.vars 或环境变量里的真实凭据，向和风天气发一次真实请求
# 会打印 API Host / 项目ID / 三种 iss 组合各自的返回码，并明确告诉你要不要配 QWEATHER_DEV_ID
# 不读取 local.properties 等任何外部文件
npm run verify:qweather

# 本地起服务（需先 cp .dev.vars.example .dev.vars 并填入真实值）
npm run dev
curl "http://127.0.0.1:8787/health"
curl "http://127.0.0.1:8787/preview?mode=today"     # 只采集+渲染，不推送
npx wrangler workflows trigger weather-report-workflow --local   # 本地触发 Workflow
# 本地 Workflow 调试面板：http://localhost:8787/cdn-cgi/local/explorer

# 线上查看数据与卡片（不推送）
curl "https://myweather-bot.cs215269.workers.dev/preview?mode=today"
curl "https://myweather-bot.cs215269.workers.dev/preview?mode=tomorrow"

# 手动触发一次完整 Workflow
curl -X POST "https://myweather-bot.cs215269.workers.dev/trigger?mode=today"

# 查看运行日志
npx wrangler tail
```

## 飞书机器人配置

1. 群聊 → 群设置 → 群机器人 → 添加「自定义机器人」，复制 Webhook 地址；
2. 若开启「签名校验」，把密钥填入 `FEISHU_SECRET`（Worker 会按 `timestamp + "\n" + secret` 做 HMAC-SHA256 签名）；
3. 若需要 @某人，可在 `src/lib/feishu.ts` 的卡片里追加 `mentions` 字段。

## 调整播报时间

改 `wrangler.toml` 的 `[triggers].crons`（**UTC**，精确到分钟），并同步修改
`src/lib/schedule.ts` 里的 `BROADCAST_CRON` 与 `MODE_BY_UTC_HOUR`，两者必须一致。

北京时间换算：`北京时间 = UTC + 8`。当前 `35 13,23 * * *` 对应：

| 北京时间 | UTC | 模式 |
| --- | --- | --- |
| 07:35（次日） | 23:35 | `today`（播今天的天气） |
| 21:35 | 13:35 | `tomorrow`（播明天的天气） |

合并成一条表达式后，`event.cron` 不再区分早晚，播报模式**只能**靠命中的 UTC 小时判断 ——
所以改动时刻时，`MODE_BY_UTC_HOUR` 必须同步更新，否则会走兜底分支。

> 想换晚间时刻？把 `BROADCAST_CRON` 的小时位改成对应的 UTC 小时，并把 `MODE_BY_UTC_HOUR`
> 的键值一起换掉。例：晚间改 19:35 → UTC 11 → `"35 11,23 * * *"` 且 `13` 改为 `11`。
> 注意**不能**用 `*/12`：`35 */12 * * *` 是 UTC 0:35 / 12:35（北京时间 08:35 / 20:35）。

## 常见问题

- **飞书返回 `code: 19001` / 签名错误**：`FEISHU_SECRET` 与机器人里的密钥不一致，或未按 `timestamp\nsecret` 拼接。
- **和风天气返回 `code: 401`**：JWT 的 `kid`/`project_id`/私钥不匹配，或私钥丢了换行（纯 Base64 也支持）。
- **Cron 没触发**：Cloudflare Cron 为 UTC 且只在整分钟触发；用 `wrangler tail` 确认事件是否到达。
- **推送了但内容是昨天/明天的数据**：检查 `TIMEZONE` 是否为 `Asia/Shanghai`，以及 `mode` 判定是否正确。


## 用户的笔记本

HTTP POST 请求方式调用 webhook 地址
```cmd
curl -X POST -H "Content-Type: application/json" -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"request example\"}}" https://open.feishu.cn/open-apis/bot/v2/hook/****
```
- 请求方式：`POST`
- 请求头：`Content-Type: application/json`
- 请求体：`{"msg_type":"text","content":{"text":"request example"}}`
- webhook 地址：`https://open.feishu.cn/open-apis/bot/v2/hook/****` 为示例值，你（AI agent）在准备完成后通知并指导用户手动配置
https://open.feishu.cn/open-apis/bot/v2/hook/c3442729-76a6-4ff9-b326-8f3d9e94f03f
向自定义机器人发送请求时，支持发送文本、富文本、群名片以及消息卡片等多种消息类型(富文本支持markdown)。各类消息类型的请求说明，参见支持发送的[消息类型说明](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot#%E6%94%AF%E6%8C%81%E5%8F%91%E9%80%81%E7%9A%84%E6%B6%88%E6%81%AF%E7%B1%BB%E5%9E%8B%E8%AF%B4%E6%98%8E)。

列表的 Markdown 语法中，编号 / 符号与后续内容之间必须保留空格，否则无法被正确解析为列表
不同列表项必须单独一行，通过\n进行换行
自定义机器人发送的消息体总大小不能超过 20KB，配置列表时需注意整体内容长度
用户043188申请添加你为联系人，点击链接处理 https://www.feishu.cn/invitation/page/add_contact/?token=04dk54df-351e-4de7-a25c-f619baaf2229

用户的[GitHub仓库](https://github.com/CS215269/cloudflare-workflows-bots)已经创建
用户的openID:ou_d8d6115538c097fa0b0dd6130ba7c1ce

