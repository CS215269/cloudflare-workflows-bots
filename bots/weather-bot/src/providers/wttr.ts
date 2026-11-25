/**
 * 数据源三：wttr.in（免费、无需 API Key，作为兜底）
 * 文档：https://wttr.in/docs
 */

import type { CurrentWeather, DailyForecast, ProviderSnapshot } from "../types.ts";

export const WTTR_PROVIDER = "wttr.in";

interface WttrResponse {
  current_condition?: {
    temp_C?: string;
    FeelsLikeC?: string;
    weatherDesc?: { value?: string }[];
    humidity?: string;
    windspeedKmph?: string;
    winddir16Point?: string;
    precipMM?: string;
    observation_time?: string;
  }[];
  weather?: {
    date?: string;
    maxtempC?: string;
    mintempC?: string;
    hourly?: {
      time?: string;
      tempC?: string;
      weatherDesc?: { value?: string }[];
      chanceofrain?: string;
      humidity?: string;
      windspeedKmph?: string;
      winddir16Point?: string;
    }[];
  }[];
}

const toNum = (v: string | undefined): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export async function fetchWttr(
  city: { name: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderSnapshot> {
  const snapshot: ProviderSnapshot = { provider: WTTR_PROVIDER, ok: false, daily: [] };
  try {
    const url = `https://wttr.in/${encodeURIComponent(city.name)}?format=j1`;
    const res = await fetchImpl(url, { headers: { "User-Agent": "myweather-bot/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as WttrResponse;

    const cc = json.current_condition?.[0];
    const current: CurrentWeather | undefined = cc
      ? {
          tempC: toNum(cc.temp_C),
          feelsLikeC: toNum(cc.FeelsLikeC),
          text: cc.weatherDesc?.[0]?.value,
          humidity: toNum(cc.humidity),
          windScale: cc.windspeedKmph ? `${cc.windspeedKmph} km/h` : undefined,
          windSpeedKmh: toNum(cc.windspeedKmph),
          windDir: cc.winddir16Point,
          precipMm: toNum(cc.precipMM),
          obsTime: cc.observation_time,
        }
      : undefined;

    const daily: DailyForecast[] = (json.weather ?? []).map((w) => {
      const noon = w.hourly?.find((h) => h.time === "1200");
      return {
        date: w.date ?? "",
        textDay: noon?.weatherDesc?.[0]?.value,
        tempMin: toNum(w.mintempC),
        tempMax: toNum(w.maxtempC),
        precipProbability: toNum(noon?.chanceofrain),
        humidity: toNum(noon?.humidity),
        windDir: noon?.winddir16Point,
        windScale: noon?.windspeedKmph ? `${noon.windspeedKmph} km/h` : undefined,
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
