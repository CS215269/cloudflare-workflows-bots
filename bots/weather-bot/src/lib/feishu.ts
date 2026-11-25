/**
 * 飞书自定义机器人 Webhook 推送。
 *
 * - 普通 Webhook：POST {"msg_type":"interactive","card":{...}}
 * - 开启"签名校验"时需额外带上 timestamp 与 sign：
 *     stringToSign = `${timestamp}\n${secret}`
 *     sign = Base64(HMAC-SHA256(key=secret, data=stringToSign))
 */

import type { WeatherReport } from "../types.ts";

export interface FeishuCard {
  msg_type: "interactive";
  card: Record<string, unknown>;
  timestamp?: string;
  sign?: string;
}

export interface SendResult {
  ok: boolean;
  code?: number | string;
  msg?: string;
  raw?: string;
}

function iconOf(text?: string, fallback = "🌈"): string {
  if (!text) return fallback;
  if (/雷/.test(text)) return "⛈️";
  if (/雪/.test(text)) return "❄️";
  if (/雨/.test(text)) return "🌧️";
  if (/雾|霾/.test(text)) return "🌫️";
  if (/阴/.test(text)) return "☁️";
  if (/多云/.test(text)) return "⛅";
  if (/晴/.test(text)) return "☀️";
  return fallback;
}

function fmtTemp(v: number | undefined, unit = "℃"): string {
  return v === undefined || v === null ? "—" : `${Math.round(v)}${unit}`;
}

function fmtRange(min?: number, max?: number): string {
  if (min === undefined && max === undefined) return "—";
  return `${fmtTemp(min)} ~ ${fmtTemp(max)}`;
}

/** 把播报内容渲染成飞书卡片 */
export function buildFeishuCard(report: WeatherReport): FeishuCard {
  const isToday = report.mode === "today";
  const day = isToday ? report.today : report.tomorrow;
  const current = report.current;

  const title = isToday
    ? `${report.city.name} 今日天气`
    : `${report.city.name} 明日天气预报`;
  const subtitle = `${report.dateLabel}${isToday ? "" : "（明天）"}`;

  const lines: string[] = [];

  if (isToday && current) {
    lines.push(
      `**${iconOf(current.text)} ${current.text ?? "未知天气"}**  ${fmtTemp(current.tempC)}` +
        (current.feelsLikeC !== undefined ? `（体感 ${fmtTemp(current.feelsLikeC)}）` : ""),
    );
    const meta: string[] = [];
    if (current.humidity !== undefined) meta.push(`湿度 ${current.humidity}%`);
    if (current.windDir || current.windScale) {
      meta.push(`风力 ${[current.windDir, current.windScale].filter(Boolean).join(" ")}`);
    }
    if (current.precipMm) meta.push(`降水量 ${current.precipMm}mm`);
    if (current.obsTime) meta.push(`观测 ${current.obsTime}`);
    if (meta.length) lines.push(`> ${meta.join(" · ")}`);
  }

  if (day) {
    const title2 = isToday ? "今日白天" : "明天";
    const dayText = day.textDay ?? day.textNight ?? "暂无";
    const nightText = day.textNight && day.textNight !== day.textDay ? `，夜间 ${day.textNight}` : "";
    lines.push(
      `**${title2}** ${iconOf(dayText)} ${dayText}${nightText}  ${fmtRange(day.tempMin, day.tempMax)}`,
    );
    const meta2: string[] = [];
    if (day.precipProbability !== undefined) meta2.push(`降水概率 ${day.precipProbability}%`);
    if (day.precipMm) meta2.push(`降水量 ${day.precipMm}mm`);
    if (day.sunrise) meta2.push(`日出 ${day.sunrise}`);
    if (day.sunset) meta2.push(`日落 ${day.sunset}`);
    if (day.windDir || day.windScale) {
      meta2.push(`风力 ${[day.windDir, day.windScale].filter(Boolean).join(" ")}`);
    }
    if (meta2.length) lines.push(`> ${meta2.join(" · ")}`);
  } else {
    lines.push("_暂无该日期的预报数据_");
  }

  if (report.tips.length) {
    lines.push(`**贴心提示**\n${report.tips.map((t) => `- ${t}`).join("\n")}`);
  }

  const srcText = report.sources
    .map((s) => `${s.ok ? "✅" : "⚠️"}${s.provider}${s.note ? `(${s.note})` : ""}`)
    .join("  ");

  const elements: Record<string, unknown>[] = [
    { tag: "div", text: { tag: "lark_md", content: lines.join("\n\n") } },
    { tag: "hr" },
    { tag: "note", elements: [{ tag: "plain_text", content: `数据来源：${srcText}` }] },
  ];

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true, update_multi: true },
      header: {
        title: { tag: "plain_text", content: `${title} · ${subtitle}` },
        template: isToday ? "blue" : "turquoise",
      },
      elements,
    },
  };
}

/** 生成签名（飞书"签名校验"模式） */
export async function createSign(
  secret: string,
  timestamp: number,
): Promise<string> {
  const stringToSign = `${timestamp}\n${secret}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** 推送到飞书群机器人 */
export async function sendToFeishu(
  webhookUrl: string,
  card: FeishuCard,
  secret?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const payload: FeishuCard = { ...card };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = await createSign(secret, timestamp);
  }
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* 非 JSON 响应 */
    }
    const code = parsed?.code ?? parsed?.StatusCode;
    const ok = res.ok && (code === undefined || code === 0);
    return {
      ok,
      code,
      msg: parsed?.msg ?? parsed?.StatusMessage ?? (ok ? "success" : raw.slice(0, 200)),
      raw: raw.slice(0, 500),
    };
  } catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}
