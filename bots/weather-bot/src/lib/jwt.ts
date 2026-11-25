/**
 * 和风天气 JWT（Ed25519）生成。
 *
 * 参考：https://dev.qweather.com/docs/configuration/authentication/
 * header: {"alg":"EdDSA","kid":"<凭据ID>"}
 * payload:{"iss":"<开发者ID>","sub":"<项目ID>","iat":<秒>,"exp":<秒>}
 *
 * 事实依据（比文档更硬）：官方 Android SDK V5.2.2 的 com.qweather.sdk.JWTGenerator
 * 字节码里拼的是 {"alg": "EdDSA", "kid": ".."} 与 {"sub": "..", "iat": .., "exp": ..}，
 * 即「项目ID 放 sub、且完全不发 iss」——该实现已在真实 App 中验证可用。
 * 因此 iss（开发者ID）在本项目里是可选的，留空即与可用实现完全一致。
 *
 * 注意两个容易写错的地方（写错会直接 401）：
 *   1) header.alg 的取值是 JOSE 规范的 "EdDSA"，不是算法名 "ED25519"
 *   2) 项目ID 放在 sub，iss 是「开发者ID」（Q 开头的 10 位），两者不是同一个值
 */

export interface JwtOptions {
  /** 项目ID，写入 payload.sub */
  projectId: string;
  /** 开发者ID（Q 开头 10 位），写入 payload.iss；不提供则省略该字段 */
  developerId?: string;
  /** 凭据ID，写入 header.kid */
  kid: string;
  privateKeyPem: string;
  /** 有效期（秒），默认 3600（官方上限 86400） */
  expiresIn?: number;
  /** 当前时间（毫秒），便于测试注入 */
  now?: number;
}

/** 官方建议 iat 取当前时间前 30 秒，避免设备时钟偏差导致 401 */
const IAT_SKEW_SECONDS = 30;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeUtf8(text: string): string {
  return base64UrlEncode(new TextEncoder().encode(text));
}

/**
 * 解析私钥为 DER 字节。
 * 同时兼容两种常见存放形式：
 *   1) PEM：-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
 *   2) 纯 Base64（Android 端 local.properties 里 breezy.qweather.private_key 就是这种形式）
 */
export function parsePrivateKey(privateKey: string): Uint8Array<ArrayBuffer> {
  const raw = privateKey.trim();
  if (raw.includes("-----BEGIN")) {
    const body = raw
      .replace(/-----BEGIN [^-]+-----/g, "")
      .replace(/-----END [^-]+-----/g, "")
      .replace(/\s+/g, "");
    const binary = atob(body);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  // 纯 Base64：可能是 PKCS8 DER，也可能直接是裸 32 字节种子
  const body = raw.replace(/\s+/g, "");
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 生成和风天气 JWT token */
export async function createQWeatherToken(opts: JwtOptions): Promise<string> {
  const { projectId, developerId, kid, privateKeyPem } = opts;
  const iat = Math.floor((opts.now ?? Date.now()) / 1000) - IAT_SKEW_SECONDS;
  const exp = iat + (opts.expiresIn ?? 3600);

  const header = base64UrlEncodeUtf8(JSON.stringify({ alg: "EdDSA", kid }));

  // 只放官方指定的字段，不要加 typ / aud / nbf（官方明确建议移除）
  const claims: Record<string, string | number> = {};
  if (developerId) claims.iss = developerId;
  claims.sub = projectId;
  claims.iat = iat;
  claims.exp = exp;
  const payload = base64UrlEncodeUtf8(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;

  let der: Uint8Array<ArrayBuffer>;
  try {
    der = parsePrivateKey(privateKeyPem);
  } catch {
    der = new Uint8Array();
  }
  // 兼容"裸 32 字节 Ed25519 种子"：手动包一层 PKCS8
  if (der.length === 32) {
    const prefix = new Uint8Array([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ]);
    const wrapped = new Uint8Array(prefix.length + 32);
    wrapped.set(prefix, 0);
    wrapped.set(der, prefix.length);
    der = wrapped;
  }

  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
