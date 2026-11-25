/**
 * 定时计划：Cron 表达式与播报模式的映射。
 *
 * Cloudflare Cron Trigger 使用 UTC，且精确到分钟。
 *
 * 本项目用**单条** cron 表达式表达「每 12 小时一次」，每天命中两个时刻：
 *   "35 13,23 * * *"
 *      -> UTC 13:35 = 北京时间 21:35  => 推送「明天」的天气
 *      -> UTC 23:35 = 北京时间次日 07:35 => 推送「今天」的天气
 *
 * 注意：合并成一条表达式后，event.cron 不再区分早晚，
 * 因此播报模式改由**命中的 UTC 小时**决定（见 MODE_BY_UTC_HOUR）。
 */

import type { ReportMode } from "../types.ts";

/** 唯一的 Cron 表达式（UTC）：35 13,23 */
export const BROADCAST_CRON = "35 13,23 * * *";

/**
 * 命中的 UTC 小时 -> 播报模式
 *   23 -> 北京时间次日 07:35（早晨播报）=> 「今天」
 *   13 -> 北京时间 21:35（晚间播报）  => 「明天」
 */
const MODE_BY_UTC_HOUR = new Map<number, ReportMode>([
  [23, "today"],
  [13, "tomorrow"],
]);

/** 依据命中的时刻决定播报模式 */
export function modeFromCron(cron: string, now: Date = new Date()): ReportMode {
  const hour = now.getUTCHours();
  const mode = MODE_BY_UTC_HOUR.get(hour);
  if (mode) return mode;
  // 兜底：cron 表达式或触发时刻异常时的粗判
  // （UTC >= 18 对应北京次日清晨，仍播「今天」；其余对应北京白天/傍晚，播「明天」）
  console.warn(`[schedule] 未预期的触发时刻: cron="${cron}" utcHour=${hour}`);
  return hour >= 18 ? "today" : "tomorrow";
}
