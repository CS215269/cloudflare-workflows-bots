/**
 * 和风天气 JWT（Ed25519）生成。
 *
 * 参考：https://dev.qweather.com/docs/authentication/
 * header: {"alg":"ED25519","kid":"<KID>"}
 * payload:{"iss":"<ProjectID>","iat":<秒>,"exp":<秒>}
 */

export interface JwtOptions {
  projectId: string;
  kid: string;
  privateKeyPem: string;
  /** 有效期（秒），默认 3600 */
  expiresIn?: number;
  /** 当前时间（毫秒），便于测试注入 */
  now?: number;
}

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
  const { projectId, kid, privateKeyPem } = opts;
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const header = base64UrlEncodeUtf8(JSON.stringify({ alg: "ED25519", kid }));
  const payload = base64UrlEncodeUtf8(
    JSON.stringify({
      iss: projectId,
      iat: nowSec,
      exp: nowSec + (opts.expiresIn ?? 3600),
    }),
  );
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
