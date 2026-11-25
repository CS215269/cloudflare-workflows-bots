/**
 * 全局类型定义。
 */

/** 播报模式：today = 今天的天气，tomorrow = 明天的天气预报 */
export type ReportMode = "today" | "tomorrow";

/** Workflow 入参 */
export interface WorkflowParams {
  /** 播报模式 */
  mode: ReportMode;
  /** 目标城市（可被请求覆盖，默认取 env 中的配置） */
  city?: {
    id: string;
    name: string;
    lat: string;
    lon: string;
  };
  /** 手动触发时用于日志追踪 */
  triggeredBy?: string;
}

/** 当前天气（归一化后的结构） */
export interface CurrentWeather {
  tempC?: number;
  feelsLikeC?: number;
  text?: string;
  icon?: string;
  humidity?: number;
  windDir?: string;
  windScale?: string;
  windSpeedKmh?: number;
  precipMm?: number;
  obsTime?: string;
}

/** 逐日预报（归一化后的结构） */
export interface DailyForecast {
  date: string;
  textDay?: string;
  textNight?: string;
  icon?: string;
  tempMin?: number;
  tempMax?: number;
  precipProbability?: number;
  precipMm?: number;
  windDir?: string;
  windScale?: string;
  sunrise?: string;
  sunset?: string;
}

/** 单个数据源的采集结果 */
export interface ProviderSnapshot {
  provider: string;
  ok: boolean;
  error?: string;
  current?: CurrentWeather;
  daily: DailyForecast[];
}

/** 聚合后的播报内容 */
export interface WeatherReport {
  mode: ReportMode;
  city: { id: string; name: string; lat: string; lon: string };
  date: string;
  dateLabel: string;
  timezone: string;
  current?: CurrentWeather;
  today?: DailyForecast;
  tomorrow?: DailyForecast;
  hourlies?: { time: string; tempC?: number; text?: string; precipProbability?: number }[];
  sources: { provider: string; ok: boolean; note?: string }[];
  tips: string[];
}

/** Worker 环境变量 */
export interface Env {
  /** Cloudflare Workflow 绑定 */
  WEATHER_WORKFLOW: any;

  /** 飞书自定义机器人 Webhook */
  FEISHU_WEBHOOK_URL?: string;
  /** 飞书机器人签名密钥（可选） */
  FEISHU_SECRET?: string;

  /** 和风天气：API Key 认证（与 JWT 认证二选一） */
  QWEATHER_API_KEY?: string;
  /** 和风天气：JWT 认证所需参数 */
  QWEATHER_PROJECT_ID?: string;
  /** 和风天气：开发者ID（Q 开头 10 位），JWT 的 iss；不填则省略 iss */
  QWEATHER_DEV_ID?: string;
  QWEATHER_KID?: string;
  QWEATHER_PRIVATE_KEY?: string;
  QWEATHER_HOST?: string;

  /** 时区与城市 */
  TIMEZONE: string;
  CITY_ID: string;
  CITY_NAME: string;
  LAT: string;
  LON: string;

  /** 数据源开关 */
  ENABLE_QWEATHER?: string;
  ENABLE_OPEN_METEO?: string;
  ENABLE_WTTR?: string;
}
