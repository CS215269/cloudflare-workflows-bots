/**
 * 数据源一：和风天气（QWeather / HeWeather）
 * - 实时天气 /v7/weather/now
 * - 7 日预报 /v7/weather/7d
 * 认证方式二选一：
 *   1) API Key：?key=xxx
 *   2) JWT（Ed25519）：Authorization: Bearer <token>
 */

import type { CurrentWeather, DailyForecast, Env, ProviderSnapshot } from "../types.ts";
import { createQWeatherToken } from "../lib/jwt.ts";

export const QWEATHER_PROVIDER = "和风天气";

interface QWeatherNowResponse {
  code: string;
  updateTime?: string;
  now?: {
    obsTime?: string;
    temp?: string;
    feelsLike?: string;
    icon?: string;
    text?: string;
    windDir?: string;
    windScale?: string;
    humidity?: string;
    precip?: string;
    pressure?: string;
  };
}

interface QWeather7DResponse {
  code: string;
  daily?: {
    fxDate?: string;
    sunrise?: string;
    sunset?: string;
    tempMax?: string;
    tempMin?: string;
    iconDay?: string;
    textDay?: string;
    textNight?: string;
    windDir?: string;
    windScale?: string;
    humidity?: string;
    precip?: string;
  }[];
}

function host(env: Env): string {
  const custom = env.QWEATHER_HOST?.trim();
  if (custom) return custom.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return "api.qweather.com";
}

function toNum(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 构造认证头/参数 */
async function buildAuth(env: Env): Promise<{ headers: Record<string, string>; keyParam?: string }> {
  if (env.QWEATHER_API_KEY?.trim()) {
    return { headers: {}, keyParam: env.QWEATHER_API_KEY.trim() };
  }
  const { QWEATHER_PROJECT_ID, QWEATHER_DEV_ID, QWEATHER_KID, QWEATHER_PRIVATE_KEY } = env;
  if (!QWEATHER_PROJECT_ID || !QWEATHER_KID || !QWEATHER_PRIVATE_KEY) {
    throw new Error(
      "和风天气认证配置缺失：需要 QWEATHER_API_KEY，或 QWEATHER_PROJECT_ID + QWEATHER_KID + QWEATHER_PRIVATE_KEY",
    );
  }
  const token = await createQWeatherToken({
    projectId: QWEATHER_PROJECT_ID,
    developerId: QWEATHER_DEV_ID,
    kid: QWEATHER_KID,
    privateKeyPem: QWEATHER_PRIVATE_KEY,
  });
  return { headers: { Authorization: `Bearer ${token}` }, keyParam: undefined };
}

export async function fetchQWeather(
  env: Env,
  city: { id: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderSnapshot> {
  const snapshot: ProviderSnapshot = { provider: QWEATHER_PROVIDER, ok: false, daily: [] };
  try {
    const { headers, keyParam } = await buildAuth(env);
    const base = `https://${host(env)}`;
    const location = encodeURIComponent(city.id);
    const q = (path: string) => {
      const url = new URL(`${base}${path}`);
      url.searchParams.set("location", location);
      if (keyParam) url.searchParams.set("key", keyParam);
      return url.toString();
    };

    const [nowRes, dailyRes] = await Promise.all([
      fetchImpl(q("/v7/weather/now"), { headers }),
      fetchImpl(q("/v7/weather/7d"), { headers }),
    ]);

    if (!nowRes.ok) throw new Error(`实时天气 HTTP ${nowRes.status}`);
    const nowJson = (await nowRes.json()) as QWeatherNowResponse;
    if (nowJson.code !== "200") throw new Error(`实时天气返回 code=${nowJson.code}`);

    const n = nowJson.now ?? {};
    const current: CurrentWeather = {
      tempC: toNum(n.temp),
      feelsLikeC: toNum(n.feelsLike),
      text: n.text,
      icon: n.icon,
      humidity: toNum(n.humidity),
      windDir: n.windDir,
      windScale: n.windScale,
      precipMm: toNum(n.precip),
      obsTime: n.obsTime ?? nowJson.updateTime,
    };

    const daily: DailyForecast[] = [];
    if (dailyRes.ok) {
      const dailyJson = (await dailyRes.json()) as QWeather7DResponse;
      if (dailyJson.code === "200" && Array.isArray(dailyJson.daily)) {
        for (const d of dailyJson.daily) {
          if (!d.fxDate) continue;
          daily.push({
            date: d.fxDate,
            textDay: d.textDay,
            textNight: d.textNight,
            icon: d.iconDay,
            tempMin: toNum(d.tempMin),
            tempMax: toNum(d.tempMax),
            precipMm: toNum(d.precip),
            windDir: d.windDir,
            windScale: d.windScale,
            sunrise: d.sunrise,
            sunset: d.sunset,
          });
        }
      }
    }

    snapshot.ok = true;
    snapshot.current = current;
    snapshot.daily = daily;
    return snapshot;
  } catch (err) {
    snapshot.error = err instanceof Error ? err.message : String(err);
    return snapshot;
  }
}
