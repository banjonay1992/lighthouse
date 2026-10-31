// Single-user authentication.
//
// Recommended: put the Worker behind Cloudflare Access and set
// ACCESS_TEAM_DOMAIN and ACCESS_AUD. Every API request must then carry a
// valid Access JWT, which is verified here as well as at the edge.
//
// Fallback: set LIGHTHOUSE_PASSPHRASE and SESSION_SECRET. Logging in with
// the passphrase sets an HMAC-signed, HttpOnly session cookie.
//
// With neither configured, the API refuses every request, except in demo
// mode where it is open (demo data only).

import type { Config, Env } from "./env";
import { base64UrlDecode, base64UrlEncode, decodeJwt, verifyRs256 } from "./lib/jwt";
import type { FetchLike } from "./providers/types";
import type { SessionInfo } from "./shared/types";

export type AuthMode = SessionInfo["authMode"];

export const SESSION_COOKIE = "lh_session";
export const SESSION_TTL_S = 30 * 24 * 3600;
const encoder = new TextEncoder();

export function authMode(env: Env, config: Config): AuthMode {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) return "access";
  if (env.LIGHTHOUSE_PASSPHRASE && env.SESSION_SECRET) return "passphrase";
  if (config.demo) return "open";
  return "unconfigured";
}

// ---- passphrase sessions ---------------------------------------------------------

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Compare a submitted passphrase with the configured one without leaking
 * timing information: both are run through HMAC first so the comparison
 * is always over 32 bytes.
 */
export async function passphraseMatches(submitted: string, expected: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmac(secret, `pass:${submitted}`), hmac(secret, `pass:${expected}`)]);
  return constantTimeEqual(a, b);
}

/**
 * The cookie value is "v1.<expiry>.<signature>". The signature covers the
 * passphrase too, so changing the passphrase signs everyone out.
 */
export async function createSessionToken(secret: string, passphrase: string, now: Date): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_TTL_S;
  const sig = await hmac(secret, `v1.${exp}.${passphrase}`);
  return `v1.${exp}.${base64UrlEncode(sig)}`;
}

export async function verifySessionToken(token: string, secret: string, passphrase: string, now: Date): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isInteger(exp) || exp * 1000 <= now.getTime()) return false;
  let given: Uint8Array;
  try {
    given = base64UrlDecode(parts[2]!);
  } catch {
    return false;
  }
  return constantTimeEqual(given, await hmac(secret, `v1.${exp}.${passphrase}`));
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(value: string, secure: boolean, maxAge = SESSION_TTL_S): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Best-effort, per-isolate brake on passphrase guessing. Pair it with a WAF rate limit. */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(private readonly maxFailures = 5, private readonly lockMs = 5 * 60_000) {}

  blocked(key: string, now: number): boolean {
    const entry = this.failures.get(key);
    return Boolean(entry && entry.count >= this.maxFailures && entry.until > now);
  }

  fail(key: string, now: number): void {
    const entry = this.failures.get(key);
    const count = entry && entry.until > now ? entry.count + 1 : 1;
    this.failures.set(key, { count, until: now + this.lockMs });
    if (this.failures.size > 1000) this.failures.clear();
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

// ---- Cloudflare Access ---------------------------------------------------------------

export function accessIssuer(teamDomain: string): string {
  const host = teamDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
}

interface Jwks {
  keys: (JsonWebKey & { kid?: string })[];
}

const jwksCache = new Map<string, { at: number; jwks: Jwks }>();

async function loadJwks(issuer: string, fetcher: FetchLike, now: number, force = false): Promise<Jwks> {
  const cached = jwksCache.get(issuer);
  if (!force && cached && now - cached.at < 3600_000) return cached.jwks;
  const res = await fetcher(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Could not load Access certificates (HTTP ${res.status})`);
  const jwks = (await res.json()) as Jwks;
  jwksCache.set(issuer, { at: now, jwks });
  return jwks;
}

export async function verifyAccessJwt(
  token: string,
  options: { teamDomain: string; audience: string; fetcher: FetchLike; now: Date },
): Promise<boolean> {
  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch {
    return false;
  }
  const issuer = accessIssuer(options.teamDomain);
  const { payload, header } = decoded;
  const nowS = options.now.getTime() / 1000;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== issuer) return false;
  if (!aud.includes(options.audience)) return false;
  if (typeof payload.exp !== "number" || payload.exp < nowS) return false;
  if (typeof payload.nbf === "number" && payload.nbf > nowS + 60) return false;

  let jwks = await loadJwks(issuer, options.fetcher, options.now.getTime());
  let key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) {
    // Access rotates keys; refetch once before giving up.
    jwks = await loadJwks(issuer, options.fetcher, options.now.getTime(), true);
    key = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!key) return false;
  return verifyRs256(decoded, key);
}

/** Exposed for tests. */
export function clearJwksCache(): void {
  jwksCache.clear();
}

// ---- request check -------------------------------------------------------------------

export async function isAuthenticated(
  request: Request,
  env: Env,
  config: Config,
  fetcher: FetchLike,
  now: Date,
): Promise<boolean> {
  switch (authMode(env, config)) {
    case "open":
      return true;
    case "unconfigured":
      return false;
    case "access": {
      const token = request.headers.get("cf-access-jwt-assertion") ?? readCookie(request, "CF_Authorization");
      if (!token) return false;
      try {
        return await verifyAccessJwt(token, {
          teamDomain: env.ACCESS_TEAM_DOMAIN!,
          audience: env.ACCESS_AUD!,
          fetcher,
          now,
        });
      } catch {
        return false;
      }
    }
    case "passphrase": {
      const token = readCookie(request, SESSION_COOKIE);
      if (!token) return false;
      return verifySessionToken(token, env.SESSION_SECRET!, env.LIGHTHOUSE_PASSPHRASE!, now);
    }
  }
}
