import { beforeEach, describe, expect, it } from "vitest";
import { handleApi, resetDemoSeed } from "../src/api/routes";
import { createContext } from "../src/context";
import type { Env } from "../src/env";
import { createTestD1 } from "./helpers/d1";
import type { EndpointSummary, ExpiryItem, Overview, ReviewPage } from "../src/shared/types";

const NOW = new Date("2026-10-30T09:00:00Z");
const ORIGIN = "https://lighthouse.example.com";

function client(envOverrides: Partial<Env> = {}) {
  const env: Env = { DB: createTestD1(), TIMEZONE: "Europe/London", ...envOverrides };
  let cookie = "";
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { origin: ORIGIN, ...headers } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
    }
    if (cookie) (init.headers as Record<string, string>).cookie = cookie;
    const res = await handleApi(new Request(`${ORIGIN}${path}`, init), createContext(env, NOW, async () => new Response("{}")));
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: res.status, body: (await res.json()) as any, headers: res.headers };
  }
  return { call, env };
}

beforeEach(() => resetDemoSeed());

describe("API on a public demo deployment", () => {
  it("is open, read-only and ignores credentials", async () => {
    const { call } = client({
      PUBLIC_DEMO: "true",
      LIGHTHOUSE_PASSPHRASE: "a passphrase that must be ignored",
      SESSION_SECRET: "secret",
      DIGEST_PROVIDER: "webhook",
      DIGEST_WEBHOOK_URL: "https://hooks.example.com/ignored",
    });
    const session = await call("GET", "/api/session");
    expect(session.body).toEqual({ authMode: "open", authenticated: true, demo: true, readOnly: true });
    const overview = await call("GET", "/api/overview");
    expect(overview.status).toBe(200);
    expect((overview.body as Overview).uptime.total).toBe(4);

    const settings = (await call("GET", "/api/settings")).body;
    expect(settings.readOnly).toBe(true);
    expect(settings.digest.provider).toBe("none");

    for (const [method, path, body] of [
      ["POST", "/api/reviews/read", { all: true }],
      ["POST", "/api/endpoints", { name: "Extra", url: "https://extra.example.com/" }],
      ["DELETE", "/api/endpoints/sync-worker", undefined],
      ["POST", "/api/run", {}],
      ["POST", "/api/digest/test", {}],
      ["POST", "/api/login", { passphrase: "a passphrase that must be ignored" }],
    ] as const) {
      const res = await call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error).toMatch(/read-only demo/);
    }
    expect(((await call("GET", "/api/endpoints")).body as EndpointSummary[]).length).toBe(4);
  });
});

describe("API in demo mode", () => {
  it("serves an overview from seeded demo data", async () => {
    const { call } = client({ DEMO_MODE: "true" });
    const session = await call("GET", "/api/session");
    expect(session.body).toEqual({ authMode: "open", authenticated: true, demo: true, readOnly: false });
    const res = await call("GET", "/api/overview");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const overview = res.body as Overview;
    expect(overview.demo).toBe(true);
    expect(overview.uptime.total).toBe(4);
    expect(overview.reviews.unread).toBeGreaterThan(0);
    expect(overview.supabase.total).toBe(3);
    // The paused staging project and the urgent profile should be flagged.
    expect(overview.attention.some((a) => a.area === "supabase")).toBe(true);
    expect(overview.attention.some((a) => a.area === "expiries")).toBe(true);
  });

  it("filters reviews and marks them read", async () => {
    const { call } = client({ DEMO_MODE: "true" });
    const low = (await call("GET", "/api/reviews?stars=1,2")).body as ReviewPage;
    expect(low.reviews.length).toBeGreaterThan(0);
    expect(low.reviews.every((r) => r.rating <= 2)).toBe(true);
    // Reviewer names are not kept by default.
    expect(low.reviews.every((r) => r.reviewer === null)).toBe(true);
    const unread = (await call("GET", "/api/reviews?unread=1")).body as ReviewPage;
    const first = unread.reviews[0]!;
    expect((await call("POST", "/api/reviews/read", { ids: [first.id] })).body).toEqual({ changed: 1 });
    expect(((await call("GET", "/api/reviews?unread=1")).body as ReviewPage).unreadTotal).toBe(unread.unreadTotal - 1);
    await call("POST", "/api/reviews/read", { all: true });
    expect(((await call("GET", "/api/reviews")).body as ReviewPage).unreadTotal).toBe(0);
  });

  it("lists endpoints with uptime and history", async () => {
    const { call } = client({ DEMO_MODE: "true" });
    const endpoints = (await call("GET", "/api/endpoints")).body as EndpointSummary[];
    expect(endpoints).toHaveLength(4);
    const sync = endpoints.find((e) => e.id === "sync-worker")!;
    expect(sync.recent.length).toBe(288);
    expect(sync.uptime24h).toBeGreaterThan(0.8);
    expect(sync.uptime24h).toBeLessThan(1);
    const detail = await call("GET", "/api/endpoints/sync-worker/checks?hours=6");
    expect(detail.body.checks.length).toBe(72);
    expect(detail.body.incidents.length).toBeGreaterThan(0);
    expect((await call("GET", "/api/endpoints/nope/checks")).status).toBe(404);
  });

  it("creates, validates and deletes endpoints, apps, reminders and releases", async () => {
    const { call } = client({ DEMO_MODE: "true" });
    expect((await call("POST", "/api/endpoints", { name: "Bad", url: "ftp://x" })).status).toBe(400);
    expect((await call("POST", "/api/endpoints", { name: "Bad", url: "https://u:p@x.example" })).status).toBe(400);
    const created = await call("POST", "/api/endpoints", { name: "New API", url: "https://new.example.com/health", expectedStatus: 204 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: "new-api", expectedStatus: 204, failureThreshold: 2, checkTls: true });
    expect((await call("POST", "/api/endpoints", { name: "New API", url: "https://x.example.com" })).status).toBe(409);
    expect((await call("DELETE", "/api/endpoints/new-api")).status).toBe(200);

    expect((await call("POST", "/api/apps", { name: "X", appstoreId: "abc" })).status).toBe(400);
    expect((await call("POST", "/api/apps", { name: "X", playPackage: "nodots" })).status).toBe(400);
    const app = await call("POST", "/api/apps", { name: "Harbour Log", appstoreId: "6400000099", playPackage: "com.example.harbour" });
    expect(app.body.id).toBe("harbour-log");

    expect((await call("POST", "/api/reminders", { title: "Renew", dueOn: "2026-02-30" })).status).toBe(400);
    const rem = await call("POST", "/api/reminders", { title: "Renew example.org", kind: "domain", dueOn: "2026-11-05", repeat: "yearly" });
    expect(rem.status).toBe(201);
    const expiries = (await call("GET", "/api/expiries")).body as ExpiryItem[];
    expect(expiries.find((e) => e.id === `reminder:${rem.body.id}`)).toMatchObject({ daysLeft: 6, severity: "urgent" });
    const done = await call("POST", `/api/reminders/${rem.body.id}/done`);
    expect(done.body.dueOn).toBe("2027-11-05");

    const rel = await call("POST", "/api/releases", { appId: "harbour-log", platform: "ios", version: "1.0.0", releaseDate: "2026-11-12" });
    expect(rel.status).toBe(201);
    expect((await call("POST", "/api/releases", { appId: "ghost", version: "1" })).status).toBe(400);
    const releases = (await call("GET", "/api/releases?from=2026-11-01&to=2026-11-30")).body as { id: string; source: string }[];
    expect(releases.some((r) => r.id === rel.body.id)).toBe(true);
    const storeRelease = (await call("GET", "/api/releases")).body.find((r: { source: string }) => r.source !== "manual");
    expect((await call("DELETE", `/api/releases/${storeRelease.id}`)).status).toBe(400);
    expect((await call("DELETE", `/api/releases/${rel.body.id}`)).status).toBe(200);
  });

  it("previews the digest and runs jobs on demand", async () => {
    const { call } = client({ DEMO_MODE: "true" });
    const preview = await call("GET", "/api/digest/preview");
    expect(preview.body.subject).toMatch(/^Lighthouse: /);
    expect(preview.body.text).toContain("Reviews");
    expect((await call("POST", "/api/digest/test", {})).status).toBe(400);
    const run = await call("POST", "/api/run", { jobs: ["uptime", "supabase"] });
    expect(run.body.outcomes.map((o: { ok: boolean }) => o.ok)).toEqual([true, true]);
    expect((await call("POST", "/api/run", { jobs: ["digest"] })).status).toBe(400);
    const settings = await call("GET", "/api/settings");
    expect(settings.body).toMatchObject({ demo: true, authMode: "open", providers: { appstore: true } });
    expect(JSON.stringify(settings.body)).not.toMatch(/secret|private/i);
  });

  it("rejects cross-origin writes, wrong content types and unknown routes", async () => {
    const { call } = client({ DEMO_MODE: "true" });
    expect((await call("POST", "/api/reviews/read", { all: true }, { origin: "https://evil.example" })).status).toBe(403);
    const res = await handleApi(
      new Request(`${ORIGIN}/api/reviews/read`, { method: "POST", body: "all=true", headers: { "content-type": "application/x-www-form-urlencoded" } }),
      createContext({ DB: createTestD1(), DEMO_MODE: "true" }, NOW),
    );
    expect(res.status).toBe(415);
    expect((await call("GET", "/api/nothing")).status).toBe(404);
    expect((await call("PUT", "/api/overview")).status).toBe(405);
  });
});

describe("API authentication", () => {
  it("refuses everything when no auth is configured outside demo mode", async () => {
    const { call } = client();
    expect((await call("GET", "/api/health")).status).toBe(200);
    const res = await call("GET", "/api/overview");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not configured/);
  });

  it("logs in with the passphrase and out again", async () => {
    const { call } = client({ LIGHTHOUSE_PASSPHRASE: "a long invented passphrase", SESSION_SECRET: "test-only-secret-0123456789" });
    expect((await call("GET", "/api/overview")).status).toBe(401);
    expect((await call("POST", "/api/login", { passphrase: "wrong" })).status).toBe(401);
    const login = await call("POST", "/api/login", { passphrase: "a long invented passphrase" });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict; Secure/);
    expect((await call("GET", "/api/overview")).status).toBe(200);
    expect((await call("GET", "/api/session")).body.authenticated).toBe(true);
    await call("POST", "/api/logout");
    expect((await call("GET", "/api/overview")).status).toBe(401);
  });

  it("locks out after repeated wrong passphrases", async () => {
    const { call } = client({ LIGHTHOUSE_PASSPHRASE: "right", SESSION_SECRET: "s" });
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    for (let i = 0; i < 5; i++) await call("POST", "/api/login", { passphrase: "nope" }, headers);
    expect((await call("POST", "/api/login", { passphrase: "right" }, headers)).status).toBe(429);
  });
});
