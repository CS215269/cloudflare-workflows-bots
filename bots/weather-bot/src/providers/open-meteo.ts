/**
 * 数据源二：Open-Meteo（免费、无需 API Key）
 * 用于补充降水概率、最高/最低温，并与和风天气交叉校验。
 */

import type { CurrentWeather, DailyForecast, ProviderSnapshot } from "../types.ts";

export const OPEN_METEO_PROVIDER = "Open-Meteo";

interface OpenMeteoResponse {
  error?: boolean;
  reason?: string;
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    weather_code?: number[];
    precipitation_probability?: number[];
  };
}

/** WMO weather code -> 中文描述 + 简笔图标（emoji） */
export function describeWeatherCode(code: number | undefined): { text: string; icon: string } {
  const table: Record<number, [string, string]> = {
    0: ["晴", "☀️"],
    1: ["晴间多云", "🌤️"],
    2: ["多云", "⛅"],
    3: ["阴", "☁️"],
    45: ["雾", "🌫️"],
    48: ["雾凇", "🌫️"],
    51: ["小毛毛雨", "🌦️"],
    53: ["毛毛雨", "🌦️"],
    55: ["大毛毛雨", "🌧️"],
    56: ["冻毛毛雨", "🌧️"],
    57: ["强冻毛毛雨", "🌧️"],
    61: ["小雨", "🌦️"],
    63: ["中雨", "🌧️"],
    65: ["大雨", "🌧️"],
    66: ["冻雨", "🌧️"],
    67: ["强冻雨", "🌧️"],
    71: ["小雪", "🌨️"],
    73: ["中雪", "🌨️"],
    75: ["大雪", "❄️"],
    77: ["米雪", "🌨️"],
    80: ["阵雨", "🌦️"],
    81: ["强阵雨", "🌧️"],
     82: ["暴雨", "⛈️"],
    85: ["阵雪", "🌨️"],
    86: ["强阵雪", "❄️"],
    95: ["雷阵雨", "⛈️"],
    96: ["雷阵雨伴冰雹", "⛈️"],
    99: ["强雷暴冰雹", "⛈️"],
  };
  const hit = code !== undefined ? table[code] : undefined;
  return { text: hit ? hit[0] : "未知", icon: hit ? hit[1] : "🌈" };
}

function windDirFromDeg(deg: number | undefined): string | undefined {
  if (deg === undefined) return undefined;
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}

export async function fetchOpenMeteo(
  env: { TIMEZONE: string },
  city: { lat: string; lon: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderSnapshot> {
  const snapshot: ProviderSnapshot = { provider: OPEN_METEO_PROVIDER, ok: false, daily: [] };
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", city.lat);
    url.searchParams.set("longitude", city.lon);
    url.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
    );
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset",
    );
    url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability");
    url.searchParams.set("timezone", env.TIMEZONE);
    url.searchParams.set("forecast_days", "7");

    const res = await fetchImpl(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as OpenMeteoResponse;
    if (json.error) throw new Error(json.reason ?? "返回错误");

    const c = json.current ?? {};
    const curDesc = describeWeatherCode(c.weather_code);
    const current: CurrentWeather = {
      tempC: c.temperature_2m,
      feelsLikeC: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      precipMm: c.precipitation,
      text: curDesc.text,
      icon: curDesc.icon,
      windSpeedKmh: c.wind_speed_10m,
      windDir: windDirFromDeg(c.wind_direction_10m),
    };

    const d = json.daily ?? {};
    const daily: DailyForecast[] = (d.time ?? []).map((date, i) => {
      const desc = describeWeatherCode(d.weather_code?.[i]);
      return {
        date,
        textDay: desc.text,
        icon: desc.icon,
        tempMin: d.temperature_2m_min?.[i],
        tempMax: d.temperature_2m_max?.[i],
        precipMm: d.precipitation_sum?.[i],
        precipProbability: d.precipitation_probability_max?.[i],
        sunrise: d.sunrise?.[i]?.slice(11, 16),
        sunset: d.sunset?.[i]?.slice(11, 16),
      };
    });

    snapshot.ok = true;
    snapshot.current = current;
    snapshot.daily = daily;
    return snapshot;
  } catch (err) {
    snapshot.error = err instanceof Error ? err.message : String(err);
    return snapshot;
  }
}
