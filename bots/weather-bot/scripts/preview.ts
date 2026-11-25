/**
 * 本地预览 / 自检脚本（无需网络、无需 Cloudflare 账号）：
 *
 *   node scripts/preview.ts
 *
 * 用 mock 数据跑通「采集 -> 聚合 -> 渲染飞书卡片」全链路，
 * 并对时间换算、Cron 映射、飞书签名做断言。
 */

import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { aggregate, buildTips } from "../src/lib/aggregate.ts";
import { buildFeishuCard, createSign } from "../src/lib/feishu.ts";
import { createQWeatherToken } from "../src/lib/jwt.ts";
import { collectSnapshots } from "../src/lib/collect.ts";
import { addDays, dateLabel, targetDate, zonedParts } from "../src/lib/time.ts";
import { BROADCAST_CRON, modeFromCron } from "../src/lib/schedule.ts";
import type { Env } from "../src/types.ts";

const TZ = "Asia/Shanghai";
const CITY = { id: "101010100", name: "北京", lat: "39.9042", lon: "116.4074" };

// ---------------------------------------------------------------------------
// mock 数据
// ---------------------------------------------------------------------------
const TODAY = "2026-11-24";
const TOMORROW = "2026-11-25";

const qweatherNow = {
  code: "200",
  updateTime: `${TODAY}T07:30+08:00`,
  now: {
    obsTime: `${TODAY}T07:00+08:00`,
    temp: "12",
    feelsLike: "10",
    icon: "101",
    text: "多云",
    windDir: "东北风",
    windScale: "3",
    humidity: "60",
    precip: "0.0",
  },
};

const qweather7d = {
  code: "200",
  daily: [
    {
      fxDate: TODAY,
      sunrise: "06:54",
      sunset: "16:52",
      tempMax: "15",
      tempMin: "4",
      iconDay: "101",
      textDay: "多云",
      textNight: "晴",
      windDir: "东北风",
      windScale: "3",
      humidity: "60",
      precip: "0.0",
    },
    {
      fxDate: TOMORROW,
      sunrise: "06:55",
      sunset: "16:51",
      tempMax: "13",
      tempMin: "2",
      iconDay: "302",
      textDay: "小雨",
      textNight: "中雨",
      windDir: "北风",
      windScale: "4",
      humidity: "75",
      precip: "3.2",
    },
  ],
};

const openMeteo = {
  timezone: TZ,
  current: {
    time: `${TODAY}T07:30`,
    temperature_2m: 11.4,
    apparent_temperature: 9.8,
    relative_humidity_2m: 63,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 11.2,
    wind_direction_10m: 45,
  },
  daily: {
    time: [TODAY, TOMORROW],
    weather_code: [2, 61],
    temperature_2m_max: [14.6, 12.8],
    temperature_2m_min: [3.9, 2.4],
    precipitation_sum: [0, 3.6],
    precipitation_probability_max: [10, 65],
    sunrise: [`${TODAY}T06:54`, `${TOMORROW}T06:55`],
    sunset: [`${TODAY}T16:52`, `${TOMORROW}T16:51`],
  },
  hourly: {
    time: [`${TODAY}T07:00`, `${TODAY}T08:00`],
    temperature_2m: [11.4, 12.1],
    weather_code: [2, 1],
    precipitation_probability: [5, 8],
  },
};

const wttr = {
  current_condition: [
    {
      temp_C: "12",
      FeelsLikeC: "10",
      weatherDesc: [{ value: "Partly cloudy" }],
      humidity: "62",
      windspeedKmph: "13",
      winddir16Point: "NE",
      precipMM: "0.0",
      observation_time: "07:30 AM",
    },
  ],
  weather: [
    { date: TODAY, maxtempC: "15", mintempC: "4" },
    { date: TOMORROW, maxtempC: "13", mintempC: "2" },
  ],
};

/** mock fetch：按 URL 分发到对应数据源 */
const mockFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

  if (url.includes("/v7/weather/now")) return json(qweatherNow);
  if (url.includes("/v7/weather/7d")) return json(qweather7d);
  if (url.includes("api.open-meteo.com")) return json(openMeteo);
  if (url.includes("wttr.in")) return json(wttr);
  return new Response("not mocked: " + url, { status: 404 });
};

const env = {
  TIMEZONE: TZ,
  CITY_ID: CITY.id,
  CITY_NAME: CITY.name,
  LAT: CITY.lat,
  LON: CITY.lon,
  ENABLE_QWEATHER: "1",
  ENABLE_OPEN_METEO: "1",
  ENABLE_WTTR: "1",
  QWEATHER_API_KEY: "mock-key",
} as unknown as Env;

// ---------------------------------------------------------------------------
// 断言工具
// ---------------------------------------------------------------------------
let failures = 0;
function check(name: string, cond: boolean, extra = ""): void {
  const mark = cond ? "✅" : "❌";
  if (!cond) failures++;
  console.log(`${mark} ${name}${extra ? ` — ${extra}` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. 时间换算
// ---------------------------------------------------------------------------
const beijingMorning = new Date("2026-11-23T23:35:00Z"); // 北京 11/24 07:35
const beijingNight = new Date("2026-11-24T13:35:00Z"); // 北京 11/24 21:35
check(
  "07:35(北京时间) 判定为今天",
  targetDate("today", beijingMorning, TZ) === TODAY,
  targetDate("today", beijingMorning, TZ),
);
check(
  "21:35(北京时间) 判定为明天",
  targetDate("tomorrow", beijingNight, TZ) === TOMORROW,
  targetDate("tomorrow", beijingNight, TZ),
);
check("跨月加天", addDays("2026-12-31", 1, TZ) === "2027-01-01", addDays("2026-12-31", 1, TZ));
check("跨年加天", addDays("2027-01-01", -1, TZ) === "2026-12-31", addDays("2027-01-01", -1, TZ));
check("时区解析", zonedParts(beijingNight, TZ).hour === 21, String(zonedParts(beijingNight, TZ).hour));
check("日期标签", dateLabel(TODAY, TZ, beijingMorning) === "11月24日 周二", dateLabel(TODAY, TZ, beijingMorning));

// ---------------------------------------------------------------------------
// 2. Cron -> 模式
// ---------------------------------------------------------------------------
check("早播 23:35(UTC) -> today", modeFromCron(BROADCAST_CRON, beijingMorning) === "today");
check("晚播 13:35(UTC) -> tomorrow", modeFromCron(BROADCAST_CRON, beijingNight) === "tomorrow");

// ---------------------------------------------------------------------------
// 3. 采集 + 聚合 + 渲染
// ---------------------------------------------------------------------------
const snapshots = await collectSnapshots(env, CITY, mockFetch);
check("三个数据源均采集成功", snapshots.every((s) => s.ok), JSON.stringify(snapshots.map((s) => `${s.provider}:${s.ok}`)));

const todayReport = aggregate({
  mode: "today",
  city: CITY,
  date: TODAY,
  dateLabel: dateLabel(TODAY, TZ, beijingMorning),
  timezone: TZ,
  snapshots,
});
const tomorrowReport = aggregate({
  mode: "tomorrow",
  city: CITY,
  date: TOMORROW,
  dateLabel: dateLabel(TOMORROW, TZ, beijingNight),
  timezone: TZ,
  snapshots,
});

check("今日报告含实时天气", Boolean(todayReport.current));
check("今日报告含今日预报", Boolean(todayReport.today));
check("今日报告不含明日", todayReport.tomorrow === undefined);
check("明日报告不含实时天气", tomorrowReport.current === undefined);
check("明日报告含明日预报", Boolean(tomorrowReport.tomorrow));
check(
  "明日降水概率由 Open-Meteo 补齐",
  tomorrowReport.tomorrow?.precipProbability === 65,
  String(tomorrowReport.tomorrow?.precipProbability),
);
check("明日提示包含带伞", tomorrowReport.tips.some((t) => t.includes("带伞")), tomorrowReport.tips.join("/"));

const card = buildFeishuCard(todayReport);
check("卡片类型为 interactive", card.msg_type === "interactive");
const cardText = JSON.stringify(card);
check("卡片包含城市名", cardText.includes("北京"));
check("卡片包含温度", cardText.includes("15"), "15℃");
check("卡片包含数据来源", cardText.includes("数据来源"));

const cardTomorrow = buildFeishuCard(tomorrowReport);
check(
  "明日卡片标题正确",
  JSON.stringify(cardTomorrow).includes("明日天气预报"),
  (cardTomorrow.card as any).header.title.content,
);

// ---------------------------------------------------------------------------
// 4. 飞书签名
// ---------------------------------------------------------------------------
const ts = 1763946000;
const sign = await createSign("my-secret", ts);
const expected = createHmac("sha256", "my-secret").update(`${ts}\nmy-secret`).digest("base64");
check("飞书签名与 HMAC-SHA256 一致", sign === expected, sign);

// ---------------------------------------------------------------------------
// 5. 和风天气 JWT（Ed25519）
// ---------------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwtNow = 1763946000000;
const token = await createQWeatherToken({
  projectId: "proj-123",
  kid: "kid-abc",
  privateKeyPem: pkcs8Pem,
  now: jwtNow,
});
const [h, p, s] = token.split(".");
const header = JSON.parse(Buffer.from(h, "base64url").toString());
const payload = JSON.parse(Buffer.from(p, "base64url").toString());
check("JWT header alg=ED25519", header.alg === "ED25519", JSON.stringify(header));
check("JWT header kid", header.kid === "kid-abc");
check("JWT payload iss=ProjectID", payload.iss === "proj-123");
check("JWT payload exp-iat=3600", payload.exp - payload.iat === 3600, String(payload.exp - payload.iat));
const verified = verify(
  null,
  Buffer.from(`${h}.${p}`),
  publicKey,
  Buffer.from(s, "base64url"),
);
check("JWT 签名可被公钥验证", verified);

// 裸 Base64 私钥（Android local.properties 的存储形式）也应可用
const bareSeed = privateKey.export({ type: "pkcs8", format: "der" }).subarray(16);
const bareToken = await createQWeatherToken({
  projectId: "proj-123",
  kid: "kid-abc",
  privateKeyPem: bareSeed.toString("base64"),
  now: jwtNow,
});
check("裸 Base64 私钥可生成 JWT", bareToken.split(".").length === 3);

// 若仓库中存在 Android 端的 local.properties，则用真实私钥验证格式兼容性
try {
  const props = await import("node:fs/promises");
  const raw = await props.readFile(new URL("../../local.properties", import.meta.url), "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("breezy.qweather.private_key="));
  if (line) {
    const key = line.slice("breezy.qweather.private_key=".length).trim();
    const t = await createQWeatherToken({ projectId: "p", kid: "k", privateKeyPem: key, now: jwtNow });
    check("Android local.properties 中的私钥格式可用", t.split(".").length === 3);
  }
} catch {
  console.log("ℹ️ 未找到 local.properties，跳过真实私钥兼容性检查");
}

// ---------------------------------------------------------------------------
// 6. 提示生成
// ---------------------------------------------------------------------------
const tips = buildTips({
  current: { text: "小雨", tempC: 18, feelsLikeC: 12, windScale: "5" },
  day: { date: TODAY, tempMin: 4, tempMax: 20, precipProbability: 80, textDay: "中雨" },
});
check("提示包含带伞", tips.some((t) => t.includes("带伞")), tips.join(" | "));
check("提示包含温差提醒", tips.some((t) => t.includes("温差")), tips.join(" | "));
check("提示包含大风提醒", tips.some((t) => t.includes("风力")), tips.join(" | "));

console.log("\n===== 今日播报卡片 JSON =====");
console.log(JSON.stringify(card, null, 2));
console.log("\n===== 明日播报卡片 JSON =====");
console.log(JSON.stringify(cardTomorrow, null, 2));

console.log(`\n${failures === 0 ? "🎉 全部检查通过" : `⚠️ 有 ${failures} 项检查未通过`}`);
process.exit(failures === 0 ? 0 : 1);
