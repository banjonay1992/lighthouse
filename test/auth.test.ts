import { beforeEach, describe, expect, it } from "vitest";
import {
  accessIssuer,
  authMode,
  clearJwksCache,
  createSessionToken,
  isAuthenticated,
  LoginThrottle,
  passphraseMatches,
  readCookie,
  sessionCookie,
  verifyAccessJwt,
  verifySessionToken,
} from "../src/auth";
import { readConfig, type Env } from "../src/env";
import { signJwt } from "../src/lib/jwt";
import { fakeFetch, json } from "./helpers/fetch";
import { generateRsaKey } from "./helpers/keys";

const NOW = new Date("2026-10-30T12:00:00Z");
const SECRET = "test-secret-not-real-0123456789abcdef";

describe("auth mode", () => {
  const base = { DB: {} as D1Database };
  it("prefers Access, then passphrase, then demo, else refuses", () => {
    const mode = (env: Env) => authMode(env, readConfig(env));
    expect(mode({ ...base, ACCESS_TEAM_DOMAIN: "team", ACCESS_AUD: "aud", LIGHTHOUSE_PASSPHRASE: "p", SESSION_SECRET: "s" })).toBe("access");
    expect(mode({ ...base, LIGHTHOUSE_PASSPHRASE: "p", SESSION_SECRET: "s" })).toBe("passphrase");
    expect(mode({ ...base, LIGHTHOUSE_PASSPHRASE: "p" })).toBe("unconfigured");
    expect(mode({ ...base, DEMO_MODE: "true" })).toBe("open");
    expect(mode(base)).toBe("unconfigured");
  });
});

describe("passphrase sessions", () => {
  it("round-trips a signed session", async () => {
    const token = await createSessionToken(SECRET, "correct horse", NOW);
    expect(await verifySessionToken(token, SECRET, "correct horse", NOW)).toBe(true);
  });

  it("rejects tampering, expiry, a new passphrase or a new secret", async () => {
    const token = await createSessionToken(SECRET, "correct horse", NOW);
    const [v, exp, sig] = token.split(".");
    expect(await verifySessionToken(`${v}.${Number(exp) + 999}.${sig}`, SECRET, "correct horse", NOW)).toBe(false);
    expect(await verifySessionToken(token, SECRET, "correct horse", new Date(NOW.getTime() + 31 * 86_400_000))).toBe(false);
    expect(await verifySessionToken(token, SECRET, "new passphrase", NOW)).toBe(false);
    expect(await verifySessionToken(token, "another-secret", "correct horse", NOW)).toBe(false);
    expect(await verifySessionToken("garbage", SECRET, "correct horse", NOW)).toBe(false);
    expect(await verifySessionToken("v1.1.!!!", SECRET, "correct horse", NOW)).toBe(false);
  });

  it("compares passphrases exactly", async () => {
    expect(await passphraseMatches("open sesame", "open sesame", SECRET)).toBe(true);
    expect(await passphraseMatches("open sesame ", "open sesame", SECRET)).toBe(false);
    expect(await passphraseMatches("", "open sesame", SECRET)).toBe(false);
  });

  it("builds a strict cookie and reads it back", () => {
    const cookie = sessionCookie("abc", true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(sessionCookie("abc", false)).not.toContain("Secure");
    const req = new Request("https://x.test", { headers: { cookie: "a=1; lh_session=v1.2.xyz=; b=2" } });
    expect(readCookie(req, "lh_session")).toBe("v1.2.xyz=");
    expect(readCookie(req, "missing")).toBeNull();
  });

  it("authenticates requests with a valid cookie only", async () => {
    const env: Env = { DB: {} as D1Database, LIGHTHOUSE_PASSPHRASE: "pp", SESSION_SECRET: SECRET };
    const config = readConfig(env);
    const token = await createSessionToken(SECRET, "pp", NOW);
    const ok = new Request("https://x.test/api/overview", { headers: { cookie: `lh_session=${token}` } });
    const no = new Request("https://x.test/api/overview");
    expect(await isAuthenticated(ok, env, config, fetch, NOW)).toBe(true);
    expect(await isAuthenticated(no, env, config, fetch, NOW)).toBe(false);
  });

  it("throttles repeated failures", () => {
    const t = new LoginThrottle(3, 60_000);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) t.fail("ip", now);
    expect(t.blocked("ip", now)).toBe(true);
    expect(t.blocked("ip", now + 61_000)).toBe(false);
    expect(t.blocked("other", now)).toBe(false);
    t.succeed("ip");
    expect(t.blocked("ip", now)).toBe(false);
  });
});

describe("Cloudflare Access", () => {
  beforeEach(() => clearJwksCache());

  async function setup() {
    const key = await generateRsaKey();
    const issuer = "https://studio.cloudflareaccess.com";
    const { fetcher, calls } = fakeFetch({
      [`${issuer}/cdn-cgi/access/certs`]: () => json({ keys: [{ ...key.jwk, kid: "k1", alg: "RS256", use: "sig" }] }),
    });
    const sign = (payload: Record<string, unknown>, kid = "k1") =>
      signJwt({ alg: "RS256", privateKey: key.privateKey, header: { kid }, payload });
    const claims = { iss: issuer, aud: ["aud-tag"], exp: NOW.getTime() / 1000 + 600, iat: NOW.getTime() / 1000, email: "owner@example.com" };
    const opts = { teamDomain: "studio", audience: "aud-tag", fetcher, now: NOW };
    return { sign, claims, opts, calls };
  }

  it("normalises the team domain", () => {
    expect(accessIssuer("studio")).toBe("https://studio.cloudflareaccess.com");
    expect(accessIssuer("https://studio.cloudflareaccess.com/")).toBe("https://studio.cloudflareaccess.com");
  });

  it("accepts a valid token and caches the keys", async () => {
    const { sign, claims, opts, calls } = await setup();
    expect(await verifyAccessJwt(await sign(claims), opts)).toBe(true);
    expect(await verifyAccessJwt(await sign(claims), opts)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("rejects wrong audience, issuer, expiry, unknown key or bad signature", async () => {
    const { sign, claims, opts } = await setup();
    expect(await verifyAccessJwt(await sign({ ...claims, aud: ["other"] }), opts)).toBe(false);
    expect(await verifyAccessJwt(await sign({ ...claims, iss: "https://evil.cloudflareaccess.com" }), opts)).toBe(false);
    expect(await verifyAccessJwt(await sign({ ...claims, exp: NOW.getTime() / 1000 - 1 }), opts)).toBe(false);
    expect(await verifyAccessJwt(await sign(claims, "unknown"), opts)).toBe(false);
    const other = await generateRsaKey();
    const forged = await signJwt({ alg: "RS256", privateKey: other.privateKey, header: { kid: "k1" }, payload: claims });
    expect(await verifyAccessJwt(forged, opts)).toBe(false);
    expect(await verifyAccessJwt("not.a.jwt", opts)).toBe(false);
  });
});
