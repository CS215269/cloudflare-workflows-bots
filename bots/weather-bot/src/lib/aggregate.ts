/**
 * 多数据源聚合：把和风天气 / Open-Meteo / wttr.in 的结果合并成一份播报内容。
 *
 * 策略：
 *  1. 选主数据源：和风天气 > Open-Meteo > wttr.in（按可靠性排序）
 *  2. 主源缺失的字段（降水概率、日出日落等）用其它数据源补齐
 *  3. 记录每个数据源的成功/失败状态，方便在卡片上体现"数据来源"
 */

import type {
  DailyForecast,
  ProviderSnapshot,
  ReportMode,
  WeatherReport,
} from "../types.ts";
import { QWEATHER_PROVIDER } from "../providers/qweather.ts";
import { OPEN_METEO_PROVIDER } from "../providers/open-meteo.ts";
import { WTTR_PROVIDER } from "../providers/wttr.ts";

export interface AggregateInput {
  mode: ReportMode;
  city: { id: string; name: string; lat: string; lon: string };
  date: string;
  dateLabel: string;
  timezone: string;
  snapshots: ProviderSnapshot[];
}

/** 按优先级挑选主数据源 */
export function pickPrimary(snapshots: ProviderSnapshot[]): ProviderSnapshot | undefined {
  const order = [QWEATHER_PROVIDER, OPEN_METEO_PROVIDER, WTTR_PROVIDER];
  for (const name of order) {
    const s = snapshots.find((x) => x.provider === name && x.ok);
    if (s) return s;
  }
  return snapshots.find((s) => s.ok);
}

/** 从所有可用数据源里找某一天 */
export function findDaily(
  snapshots: ProviderSnapshot[],
  date: string,
): DailyForecast | undefined {
  for (const s of snapshots) {
    const hit = s.daily.find((d) => d.date === date);
    if (hit) return hit;
  }
  return undefined;
}

/** 用其它数据源补齐主源缺失字段 */
function enrich(target: DailyForecast, others: DailyForecast[]): DailyForecast {
  const merged: DailyForecast = { ...target };
  for (const o of others) {
    if (merged.precipProbability === undefined && o.precipProbability !== undefined) {
      merged.precipProbability = o.precipProbability;
    }
    if (merged.precipMm === undefined && o.precipMm !== undefined) merged.precipMm = o.precipMm;
    if (merged.sunrise === undefined && o.sunrise !== undefined) merged.sunrise = o.sunrise;
    if (merged.sunset === undefined && o.sunset !== undefined) merged.sunset = o.sunset;
    if (merged.textDay === undefined && o.textDay !== undefined) merged.textDay = o.textDay;
    if (merged.icon === undefined && o.icon !== undefined) merged.icon = o.icon;
  }
  return merged;
}

/** 生成贴心提示 */
export function buildTips(report: {
  current?: { text?: string; tempC?: number; feelsLikeC?: number; windScale?: string };
  day?: DailyForecast;
  /** 播报模式，决定提示文案里用"今日"还是"明日" */
  mode?: ReportMode;
}): string[] {
  const tips: string[] = [];
  const { current, day } = report;
  const label = report.mode === "tomorrow" ? "明日" : "今日";

  const rainLike = /雨|雪|阵雨|雷|冰雹|冻雨|毛毛雨|shower|rain|snow|thunder/i;
  const prob = day?.precipProbability;
  if ((prob !== undefined && prob >= 40) || (day?.textDay && rainLike.test(day.textDay))) {
    tips.push("☔️ 有降水可能，出门记得带伞");
  }
  if (
    current?.text &&
    rainLike.test(current.text) &&
    !tips.some((t) => t.includes("带伞"))
  ) {
    tips.push("☔️ 当前有降水，出门记得带伞");
  }
  if (day?.tempMax !== undefined && day?.tempMin !== undefined) {
    const diff = day.tempMax - day.tempMin;
    if (diff >= 10) tips.push(`🌡️ ${label}温差 ${diff.toFixed(0)}℃，注意增减衣物`);
  }
  const wind = current?.windScale ?? day?.windScale;
  if (wind) {
    const windNum = Number.parseFloat(wind);
    if (Number.isFinite(windNum) && windNum >= 5) tips.push(`💨 风力偏大（${wind}），注意高空坠物`);
  }
  if (
    current?.tempC !== undefined &&
    current?.feelsLikeC !== undefined &&
    Math.abs(current.tempC - current.feelsLikeC) >= 5
  ) {
    tips.push("🥶 体感温度与实测温差较大，注意保暖");
  }
  if (tips.length === 0) tips.push("🙂 天气不错，适合出行");
  return tips;
}

export function aggregate(input: AggregateInput): WeatherReport {
  const { mode, city, date, dateLabel, timezone, snapshots } = input;
  const primary = pickPrimary(snapshots);

  const allDaily = snapshots.flatMap((s) => s.daily);
  const found = findDaily(snapshots, date);
  const day = found ? enrich(found, allDaily.filter((d) => d.date === date && d !== found)) : undefined;

  const current = primary?.current;

  // 交叉校验：两个数据源温差超过 3℃ 时给出提示
  const sources: WeatherReport["sources"] = snapshots.map((s) => ({
    provider: s.provider,
    ok: s.ok,
    note: s.ok ? undefined : s.error,
  }));

  const temps = snapshots
    .map((s) => s.current?.tempC)
    .filter((t): t is number => typeof t === "number");
  if (temps.length >= 2) {
    const spread = Math.max(...temps) - Math.min(...temps);
    if (spread >= 3) {
      const note = `多源温差 ${spread.toFixed(1)}℃`;
      const first = sources.find((s) => s.ok);
      if (first) first.note = note;
    }
  }

  const report: WeatherReport = {
    mode,
    city,
    date,
    dateLabel,
    timezone,
    current: mode === "today" ? current : undefined,
    today: mode === "today" ? day : undefined,
    tomorrow: mode === "tomorrow" ? day : undefined,
    sources,
    tips: [],
  };
  report.tips = buildTips({ current: report.current, day, mode });
  return report;
}
