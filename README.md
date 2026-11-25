# cloudflare-workflows-bots

基于 [Cloudflare Workers Workflows](https://developers.cloudflare.com/workflows/) 的机器人合集。

**每个 bot 是一个独立的 Worker**，独立部署、独立回滚、独立配置机密。一个 bot 挂掉不会影响其它 bot。

## 目录结构

```
cloudflare-workflows-bots/
├── bots/
│   ├── weather-bot/          # 定时天气播报 → 飞书群
│   │   ├── src/
│   │   │   ├── index.ts              # Worker 入口：cron + HTTP 接口
│   │   │   ├── workflows/            # Workflow 编排（采集 → 聚合 → 推送）
│   │   │   ├── providers/            # 和风天气 / Open-Meteo / wttr.in
│   │   │   └── lib/                  # 聚合、飞书卡片、JWT、时区
│   │   ├── scripts/preview.ts        # 离线自检（无需网络/账号）
│   │   ├── wrangler.toml
│   │   └── README.md                 # 该 bot 的详细文档
│   └── <新 bot>/
├── packages/                 # 跨 bot 复用的代码（卡片渲染 / 多源聚合 / 飞书签名）
├── AGENTS.md                 # 工作上下文：关键决策、当前状态、待办清单
├── package.json              # npm workspaces 根
└── README.md
```

## 环境要求

- Node.js ≥ 22.6（自带 TypeScript 类型剥离，可直接 `node xxx.ts` 运行）
- Cloudflare 账号（**Workers Free 计划即可** —— Workflows 已包含在免费计划内）

## 快速开始

```bash
# 在仓库根执行
npm install

# 全仓类型检查
npm run typecheck

# 跑各 bot 的离线自检（mock 数据，不需要网络 / 账号 / 密钥）
npm run preview
```

## Bot 列表

| Bot | Worker 名 | 线上地址 | 说明 |
|---|---|---|---|
| `weather-bot` | `myweather-bot` | `myweather-bot.cs215269.workers.dev` | 每天两次（07:35 / 21:35 北京时间）自动播报天气到飞书群；多数据源聚合 + 温差交叉校验 |

## 部署

```bash
# 1) 登录（一次性）
npx wrangler login

# 2) 在 bot 目录下配置机密
cd bots/weather-bot
npx wrangler secret put FEISHU_WEBHOOK_URL   # 飞书群自定义机器人 Webhook（必填）
npx wrangler secret put FEISHU_SECRET         # 机器人开了「签名校验」才需要
npx wrangler secret put QWEATHER_API_KEY      # 和风天气 API Key（或用 JWT 三件套）

# 3) 部署（在仓库根执行）
npm run deploy:weather

# 4) 冒烟
curl "https://myweather-bot.cs215269.workers.dev/health"
curl "https://myweather-bot.cs215269.workers.dev/preview?mode=today"
curl -X POST "https://myweather-bot.cs215269.workers.dev/trigger?mode=today"
npm run tail:weather
```

本地开发（在 `bots/weather-bot/` 下）：

```bash
cp .dev.vars.example .dev.vars   # 填入真实值，勿提交
npm run dev                       # http://127.0.0.1:8787
```

## 账号与配额

Workers Free 计划的额度对本仓库完全够用（官方定价见 [Workflows Pricing](https://developers.cloudflare.com/workflows/reference/pricing/)）：

| 项目 | Free 额度 | 本仓库用量 |
|---|---|---|
| Workers 数量 | 100 / 账号 | 1 |
| Cron Triggers | **5 / 账号** | 1（weather-bot，合并成单条 `35 13,23 * * *`） |
| 请求数 | 100,000 / 天 | 约 2 / 天 |
| Workflow Steps | 3,000 / 天 | 10 / 天（2 次 × 5 步） |
| 单次调用 CPU | **10 ms** | 各 step 实测 0.03–2.3 ms |

> ⚠️ **Cron Triggers 是 5 条/账号**，不是每个 Worker 5 条。加新 bot 时要先在 Dashboard 确认占用。
> 免费计划无法用 `limits.cpu_ms` 调高 CPU 上限（该配置仅 Paid 可用），CPU 超限只能优化代码。

## 新增一个 bot

1. `mkdir -p bots/<name>/src` 并创建 `bots/<name>/package.json`（`name` 字段即 npm workspace 名）
2. 写 `wrangler.toml`，`name` 用一个新的 Worker 名（账号内唯一）
3. 需要复用的公共逻辑放进 `packages/` 下的共享包
4. 在根 `package.json` 的 scripts 里加一条 `deploy:<name>`
5. `npm install` 后 `npm run typecheck`

## 约定

- 机密只走 `wrangler secret put` / `.dev.vars`，**不进代码、不进仓库**
- `wrangler.toml` 的 `[triggers].crons` 与该 bot `src/lib/schedule.ts` 里的 `BROADCAST_CRON` / `MODE_BY_UTC_HOUR` 必须保持一致，否则模式判断会走兜底分支
- Cloudflare Cron 使用 **UTC**，且只在整分钟触发（北京时间 = UTC + 8）
