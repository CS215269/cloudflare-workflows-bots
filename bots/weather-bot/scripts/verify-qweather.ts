/**
 * 和风天气鉴权「真实网络」自检。
 *
 * preview.ts 是纯离线的（自签自验），无法证明和风天气真的接受你的 JWT。
 * 本脚本用真实凭据向真实 API 发一次请求，从而回答两个离线测不出来的问题：
 *   1) 你的私钥 / kid / 项目ID / API Host 是否真的匹配
 *   2) JWT 里到底需不需要 iss（开发者ID）—— 三种组合各试一次，看谁返回 code=200
 *
 * 凭据来源（优先级从高到低）：
 *   1. 环境变量 QWEATHER_HOST / QWEATHER_PROJECT_ID / QWEATHER_DEV_ID / QWEATHER_KID / QWEATHER_PRIVATE_KEY
 *   2. 同目录上一级的 .dev.vars（与 wrangler dev 共用，已在 .gitignore 中）
 *
 * 本脚本不读取 local.properties 等任何外部文件。
 *
 * 用法：
 *   node scripts/verify-qweather.ts
 */

import { readFile } from "node:fs/promises";
import { createQWeatherToken } from "../src/lib/jwt.ts";

// ---------------------------------------------------------------------------
// 读取配置
// ---------------------------------------------------------------------------

async function readDevVars(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[t.slice(0, eq).trim()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const fromFile = await readDevVars();
const env = (key: string): string | undefined => {
  const v = process.env[key]?.trim() || fromFile[key]?.trim();
  return v ? v : undefined;
};

const rawHost = env("QWEATHER_HOST");
const host = (rawHost ?? "api.qweather.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const projectId = env("QWEATHER_PROJECT_ID");
const devId = env("QWEATHER_DEV_ID");
const kid = env("QWEATHER_KID");
const privateKey = env("QWEATHER_PRIVATE_KEY");
const location = env("CITY_ID") ?? "101010100";

const missing = [
  ["QWEATHER_PROJECT_ID", projectId],
  ["QWEATHER_KID", kid],
  ["QWEATHER_PRIVATE_KEY", privateKey],
].filter(([, v]) => !v).map(([k]) => k);

if (missing.length > 0) {
  console.error(`❌ 缺少配置：${missing.join(", ")}`);
  console.error("   请在环境变量或 bots/weather-bot/.dev.vars 里填写后重试。");
  process.exit(1);
}

console.log(`API Host   : ${host}${rawHost ? "" : "  ⚠️ 未设置 QWEATHER_HOST，正在使用已弃用的公共地址"}`);
console.log(`项目ID     : ${projectId}`);
console.log(`开发者ID   : ${devId ?? "（未设置）"}`);
console.log(`凭据ID     : ${kid}`);
console.log(`私钥长度   : ${privateKey!.length} 字符`);
console.log(`查询城市   : ${location}`);
console.log();

// ---------------------------------------------------------------------------
// 三种 iss 组合：看真实 API 接受哪一个
// ---------------------------------------------------------------------------

interface Variant {
  label: string;
  developerId?: string;
}

// 顺序有讲究：官方 Android SDK V5.2.2 的 JWTGenerator 就是「只发 sub、不发 iss」，
// 所以先试这一组——正常情况下第一条就通过，省一次请求。
const variants: Variant[] = [];
variants.push({ label: "不带 iss（官方 Android SDK 的做法）", developerId: undefined });
if (devId) variants.push({ label: `iss = 开发者ID (${devId})`, developerId: devId });
if (devId !== projectId) {
  variants.push({ label: `iss = 项目ID（旧实现写法）`, developerId: projectId });
}

function decodePart(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

const url = `https://${host}/v7/weather/now?location=${encodeURIComponent(location)}`;
let winner: Variant | undefined;

for (const [i, v] of variants.entries()) {
  console.log(`—— 尝试 ${i + 1}/${variants.length}：${v.label}`);
  let token: string;
  try {
    token = await createQWeatherToken({
      projectId: projectId!,
      developerId: v.developerId,
      kid: kid!,
      privateKeyPem: privateKey!,
    });
  } catch (err) {
    console.error(`   私钥无法用于签名：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const [, payloadPart] = token.split(".");
  console.log(`   payload: ${JSON.stringify(decodePart(payloadPart))}`);

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    console.error(`   请求失败（网络问题）：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const text = await res.text();
  let body: { code?: string; now?: { temp?: string; text?: string } } = {};
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`   HTTP ${res.status}，响应不是 JSON：${text.slice(0, 200)}`);
    continue;
  }

  if (res.ok && body.code === "200") {
    console.log(`   ✅ HTTP ${res.status} code=200  当前 ${body.now?.temp ?? "?"}℃ ${body.now?.text ?? ""}`);
    winner = v;
    break;
  }

  console.log(`   ❌ HTTP ${res.status} code=${body.code ?? "?"}  ${text.slice(0, 160)}`);
  if (body.code === "401" || res.status === 401) {
    console.log("      → 鉴权失败。常见原因：alg 不是 EdDSA、kid 与公钥不匹配、私钥与上传的公钥不是一对、iat/exp 偏差");
  } else if (body.code === "403") {
    console.log("      → 凭据无权限访问该 API（检查控制台里这个项目的可用服务）");
  } else if (body.code === "402") {
    console.log("      → 超出用量/配额");
  } else if (body.code === "404") {
    console.log("      → 路径或 API Host 不对（host 是否填成了带路径的 URL？）");
  } else if (res.status === 401) {
    console.log("      → HTTP 401，优先检查 API Host 是否与凭据所属账号一致（API Host 也是鉴权的一部分）");
  }
  console.log();
}

console.log();
if (winner) {
  console.log(`🎉 鉴权通过，可用组合：${winner.label}`);
  if (winner.developerId === undefined) {
    console.log("   结论：与官方 Android SDK 行为一致 —— 不需要开发者ID，QWEATHER_DEV_ID 留空即可。");
  } else if (winner.developerId === projectId) {
    console.log("   结论：这个账号要求 iss 填「项目ID」（旧实现写法），不需要开发者ID。");
  } else {
    console.log("   结论：这个账号的 iss 必须是开发者ID，请设置 QWEATHER_DEV_ID。");
  }
} else {
  console.error("❌ 所有组合都失败，请对照上面的错误码逐项排查。");
  process.exit(1);
}
