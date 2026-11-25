/**
 * 天气播报 Workflow。
 *
 * 由 Cron Trigger（或手动 HTTP 请求）创建实例：
 *   1) collect-*：并发采集各天气数据源（每步独立重试，互不影响）
 *   2) aggregate：多源聚合，生成播报内容
 *   3) push      ：渲染飞书卡片并推送到群机器人
 *
 * 步骤之间天然可重试：某个数据源失败不会导致整体失败，聚合时会用其它源兜底。
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env, ProviderSnapshot, ReportMode, WorkflowParams } from "../types.ts";
import { aggregate } from "../lib/aggregate.ts";
import { buildFeishuCard, sendToFeishu } from "../lib/feishu.ts";
import { dateLabel, targetDate } from "../lib/time.ts";
import { fetchOpenMeteo } from "../providers/open-meteo.ts";
import { fetchQWeather } from "../providers/qweather.ts";
import { fetchWttr } from "../providers/wttr.ts";

export interface WorkflowResult {
  ok: boolean;
  mode: ReportMode;
  city: string;
  date: string;
  sources: { provider: string; ok: boolean; note?: string }[];
  push?: { ok: boolean; code?: number | string; msg?: string };
  error?: string;
}

export class WeatherReportWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<WorkflowResult> {
    const params = event.payload;
    const env = this.env;
    const mode: ReportMode = params.mode === "tomorrow" ? "tomorrow" : "today";
    const city = params.city ?? {
      id: env.CITY_ID,
      name: env.CITY_NAME,
      lat: env.LAT,
      lon: env.LON,
    };
    const tz = env.TIMEZONE || "Asia/Shanghai";
    const now = new Date();
    const date = targetDate(mode, now, tz);
    const label = dateLabel(date, tz, now);

    // ---- 步骤 1：采集数据源（各自独立，失败不影响其它源） ----
    const qweather: ProviderSnapshot = await step.do("collect-qweather", async () => {
      if ((env.ENABLE_QWEATHER ?? "1") === "0") {
        return { provider: "和风天气", ok: false, error: "已禁用", daily: [] } satisfies ProviderSnapshot;
      }
      return fetchQWeather(env, city);
    });

    const openMeteo: ProviderSnapshot = await step.do("collect-open-meteo", async () => {
      if ((env.ENABLE_OPEN_METEO ?? "1") === "0") {
        return { provider: "Open-Meteo", ok: false, error: "已禁用", daily: [] } satisfies ProviderSnapshot;
      }
      return fetchOpenMeteo(env, city);
    });

    const wttr: ProviderSnapshot = await step.do("collect-wttr", async () => {
      if ((env.ENABLE_WTTR ?? "0") === "0") {
        return { provider: "wttr.in", ok: false, error: "已禁用", daily: [] } satisfies ProviderSnapshot;
      }
      return fetchWttr(city);
    });

    // ---- 步骤 2：聚合 ----
    const report = await step.do("aggregate", async () =>
      aggregate({
        mode,
        city,
        date,
        dateLabel: label,
        timezone: tz,
        snapshots: [qweather, openMeteo, wttr],
      }),
    );

    // ---- 步骤 3：推送飞书 ----
    const push = await step.do("push-feishu", async () => {
      const url = env.FEISHU_WEBHOOK_URL;
      if (!url) {
        return { ok: false, msg: "未配置 FEISHU_WEBHOOK_URL，跳过推送" };
      }
      const card = buildFeishuCard(report);
      const res = await sendToFeishu(url, card, env.FEISHU_SECRET);
      if (!res.ok) {
        // 抛错让 Cloudflare 自动重试该步骤（最多重试 5 次）
        throw new Error(`飞书推送失败: ${res.msg ?? "unknown"}`);
      }
      return { ok: true, code: res.code, msg: res.msg };
    });

    return {
      ok: true,
      mode,
      city: city.name,
      date,
      sources: report.sources,
      push,
    };
  }
}
