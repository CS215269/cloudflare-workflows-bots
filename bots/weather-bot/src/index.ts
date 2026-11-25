/**
 * Worker 入口。
 *
 * - scheduled：由 Cloudflare Cron Trigger 触发，创建 Workflow 实例
 * - fetch：提供健康检查 / 手动触发 / 预览卡片 三个 HTTP 接口
 *
 * Cron（UTC） -> 播报模式（单条表达式，每 12 小时触发两次）：
 *   "35 13,23 * * *"
 *      -> 北京时间 21:35     -> 推送“明天”
 *      -> 北京时间次日 07:35 -> 推送“今天”
 */

import type { Env, ReportMode, WorkflowParams } from "./types.ts";
import { WeatherReportWorkflow } from "./workflows/weather-report.ts";
import { aggregate } from "./lib/aggregate.ts";
import { buildFeishuCard } from "./lib/feishu.ts";
import { collectSnapshots } from "./lib/collect.ts";
import { dateLabel, targetDate } from "./lib/time.ts";
import { BROADCAST_CRON, modeFromCron } from "./lib/schedule.ts";

export { WeatherReportWorkflow };
export { BROADCAST_CRON, modeFromCron };

/** 依据命中的 Cron 表达式决定播报模式 */

function cityFromEnv(env: Env): WorkflowParams["city"] {
  return { id: env.CITY_ID, name: env.CITY_NAME, lat: env.LAT, lon: env.LON };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  /** Cron Trigger：每天两次，创建 Workflow 实例执行播报 */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date(event.scheduledTime ?? Date.now());
    const mode = modeFromCron(event.cron, now);
    const params: WorkflowParams = {
      mode,
      city: cityFromEnv(env),
      triggeredBy: `cron:${event.cron}`,
    };
    console.log(`[cron] ${event.cron} -> mode=${mode} 开始执行天气播报`);
    const instance = await env.WEATHER_WORKFLOW.create({ params });
    console.log(`[cron] workflow instance created: ${instance?.id ?? "unknown"}`);
  },

  /** HTTP 接口：健康检查 / 手动触发 / 预览 */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json({
        ok: true,
        service: "myweather-bot",
        now: new Date().toISOString(),
        timezone: env.TIMEZONE,
        city: cityFromEnv(env),
        crons: { broadcast: BROADCAST_CRON },
        configured: {
          feishuWebhook: Boolean(env.FEISHU_WEBHOOK_URL),
          feishuSign: Boolean(env.FEISHU_SECRET),
          qweatherKey: Boolean(env.QWEATHER_API_KEY),
          qweatherJwt: Boolean(env.QWEATHER_PROJECT_ID && env.QWEATHER_KID && env.QWEATHER_PRIVATE_KEY),
        },
      });
    }

    // 手动触发一次完整 Workflow（走 Cloudflare Workflows，带重试与可观测性）
    if (path === "/trigger" && request.method === "POST") {
      const mode = (url.searchParams.get("mode") ?? "today") as ReportMode;
      const params: WorkflowParams = { mode, city: cityFromEnv(env), triggeredBy: "manual" };
      const instance = await env.WEATHER_WORKFLOW.create({ params });
      return json({ ok: true, mode, instanceId: instance?.id ?? null }, 202);
    }

    // 预览：只采集 + 渲染卡片，不推送（用于调样式、确认数据）
    if (path === "/preview") {
      const mode = (url.searchParams.get("mode") ?? "today") as ReportMode;
      const city = cityFromEnv(env)!;
      const tz = env.TIMEZONE || "Asia/Shanghai";
      const now = new Date();
      const date = targetDate(mode, now, tz);
      const snapshots = await collectSnapshots(env, city);
      const report = aggregate({
        mode,
        city: city!,
        date,
        dateLabel: dateLabel(date, tz, now),
        timezone: tz,
        snapshots,
      });
      return json({ report, card: buildFeishuCard(report) });
    }

    return json({ ok: false, error: "not found", path }, 404);
  },
};
