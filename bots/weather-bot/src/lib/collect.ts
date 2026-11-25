/**
 * 采集入口：按开关并发调用多个天气数据源。
 * Workflow 的各 step 与本地预览脚本共用这段逻辑。
 */

import type { Env, ProviderSnapshot } from "../types.ts";
import { fetchQWeather } from "../providers/qweather.ts";
import { fetchOpenMeteo } from "../providers/open-meteo.ts";
import { fetchWttr } from "../providers/wttr.ts";

export interface CollectCity {
  id: string;
  name: string;
  lat: string;
  lon: string;
}

function enabled(env: Env, key: "ENABLE_QWEATHER" | "ENABLE_OPEN_METEO" | "ENABLE_WTTR"): boolean {
  const v = env[key];
  if (v === undefined || v === "") return true; // 未配置时默认开启
  return v !== "0" && v.toLowerCase() !== "false";
}

/** 并发采集所有启用的数据源 */
export async function collectSnapshots(
  env: Env,
  city: CollectCity,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderSnapshot[]> {
  const tasks: Promise<ProviderSnapshot>[] = [];

  if (enabled(env, "ENABLE_QWEATHER")) {
    tasks.push(fetchQWeather(env, city, fetchImpl));
  }
  if (enabled(env, "ENABLE_OPEN_METEO")) {
    tasks.push(fetchOpenMeteo(env, city, fetchImpl));
  }
  if (enabled(env, "ENABLE_WTTR")) {
    tasks.push(fetchWttr(city, fetchImpl));
  }

  const settled = await Promise.all(tasks);
  return settled;
}
