// Minimal JWT signing and verification on top of WebCrypto, which is
// available both in Workers and in Node. Only the algorithms Lighthouse
// needs are supported: ES256 (App Store Connect), RS256 (Google service
// accounts, Cloudflare Access).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Convert a PEM private key (PKCS#8, "BEGIN PRIVATE KEY") to DER bytes.
 * Secrets pasted into environment variables often have literal "\n"
 * sequences instead of newlines, so those are accepted too.
 */
export function pemToDer(pem: string): Uint8Array {
  const normalised = pem.replace(/\\n/g, "\n").trim();
  if (/BEGIN (EC|RSA) PRIVATE KEY/.test(normalised)) {
    throw new Error("Expected a PKCS#8 key (BEGIN PRIVATE KEY). Convert it with: openssl pkcs8 -topk8 -nocrypt");
  }
  const body = normalised
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("Private key is empty");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type JwtAlgorithm = "ES256" | "RS256";

type ImportAlgorithm = Parameters<SubtleCrypto["importKey"]>[2];
type SignAlgorithm = Parameters<SubtleCrypto["sign"]>[0];

const IMPORT_PARAMS: Record<JwtAlgorithm, ImportAlgorithm> = {
  ES256: { name: "ECDSA", namedCurve: "P-256" },
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
};

const SIGN_PARAMS: Record<JwtAlgorithm, SignAlgorithm> = {
  ES256: { name: "ECDSA", hash: "SHA-256" },
  RS256: { name: "RSASSA-PKCS1-v1_5" },
};

export async function importPrivateKey(pem: string, alg: JwtAlgorithm): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey("pkcs8", der, IMPORT_PARAMS[alg], false, ["sign"]);
}

export interface SignJwtOptions {
  alg: JwtAlgorithm;
  privateKey: CryptoKey | string;
  header?: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/**
 * Sign a compact JWS. WebCrypto's ECDSA output is already the raw r||s
 * form JWS expects, so no DER conversion is needed.
 */
export async function signJwt(options: SignJwtOptions): Promise<string> {
  const key =
    typeof options.privateKey === "string" ? await importPrivateKey(options.privateKey, options.alg) : options.privateKey;
  const header = { alg: options.alg, typ: "JWT", ...options.header };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(options.payload))}`;
  const signature = await crypto.subtle.sign(SIGN_PARAMS[options.alg], key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");
  const [h, p, s] = parts as [string, string, string];
  return {
    header: JSON.parse(decoder.decode(base64UrlDecode(h))) as Record<string, unknown>,
    payload: JSON.parse(decoder.decode(base64UrlDecode(p))) as Record<string, unknown>,
    signingInput: `${h}.${p}`,
    signature: base64UrlDecode(s),
  };
}

/** Verify an RS256 signature with a public JWK. Claims are checked by the caller. */
export async function verifyRs256(token: DecodedJwt, jwk: JsonWebKey): Promise<boolean> {
  if (token.header.alg !== "RS256") return false;
  const key = await crypto.subtle.importKey("jwk", jwk, IMPORT_PARAMS.RS256, false, ["verify"]);
  return crypto.subtle.verify(SIGN_PARAMS.RS256, key, token.signature, encoder.encode(token.signingInput));
}
