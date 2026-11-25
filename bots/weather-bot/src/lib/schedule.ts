/**
 * 定时计划：Cron 表达式与播报模式的映射。
 *
 * Cloudflare Cron Trigger 使用 UTC，且精确到分钟：
 *   "36 23 * * *"  -> 北京时间次日 07:36  => 推送“今天”的天气
 *   "0 13 * * *"   -> 北京时间 21:00     => 推送“明天”的天气
 */

import type { ReportMode } from "../types.ts";

export const MORNING_CRON = "36 23 * * *";
export const EVENING_CRON = "0 13 * * *";

/** 依据命中的 Cron 表达式决定播报模式 */
export function modeFromCron(cron: string, now: Date = new Date()): ReportMode {
  if (cron === MORNING_CRON) return "today";
  if (cron === EVENING_CRON) return "tomorrow";
  // 兜底：按 UTC 小时推断（23 点 -> 北京次日早晨，13 点 -> 北京晚上）
  const hour = now.getUTCHours();
  if (hour === 13) return "tomorrow";
  return "today";
}
