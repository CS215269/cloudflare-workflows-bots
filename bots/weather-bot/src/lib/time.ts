import type { ReportMode } from "../types.ts";

/**
 * 时间工具：全部以业务时区（默认 Asia/Shanghai）为准。
 * Worker 运行时默认 UTC，做"今天/明天"判断时必须显式换算，否则晚上 9 点会算错日期。
 */

/** 取某个时间点在指定时区的日历字段 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayEn = parts.weekday ?? "Mon";
  const weekdayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayEn);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl 在午夜可能返回 "24"，归一化为 0
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[weekdayIdx < 0 ? 0 : weekdayIdx],
  };
}

/** 格式化成 YYYY-MM-DD */
export function formatDate(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

/** 在时区下加减天数，返回新的 YYYY-MM-DD */
export function addDays(dateStr: string, days: number, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  // 以 UTC 正午做基准做日期算术，避免夏令时/时区偏移造成的跳日
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return formatDate({
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  });
}

/**
 * 依据播报模式计算目标日期。
 * - today    -> 业务时区的“今天”
 * - tomorrow -> 业务时区的“明天”
 */
export function targetDate(mode: ReportMode, now: Date, timeZone: string): string {
  const today = formatDate(zonedParts(now, timeZone));
  return mode === "tomorrow" ? addDays(today, 1, timeZone) : today;
}

/** 人类可读的日期标签，例如 "11月24日 周二" */
export function dateLabel(dateStr: string, timeZone: string, now: Date): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = zonedParts(new Date(Date.UTC(y, m - 1, d, 12)), timeZone).weekday;
  return `${m}月${d}日 ${weekday}`;
}
