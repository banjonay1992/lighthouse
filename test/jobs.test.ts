import { describe, expect, it } from "vitest";
import { Store } from "../src/db/store";
import { readConfig } from "../src/env";
import { runJobs, runScheduledTick, type JobContext } from "../src/jobs";
import { seedDemo } from "../src/demo/seed";
import { buildProviders } from "../src/providers/registry";
import type { ProbeResult, Providers, UptimeProvider } from "../src/providers/types";
import { createTestD1 } from "./helpers/d1";
import type { DigestPreview } from "../src/shared/types";

const NOW = new Date("2026-10-30T09:00:00Z");
const T0 = "2026-10-01T00:00:00Z";

class ScriptedUptime implements UptimeProvider {
  constructor(public results: ProbeResult[]) {}
  async probe(): Promise<ProbeResult> {
    return this.results.shift() ?? { ok: true, statusCode: 200, latencyMs: 50, error: null };
  }
}

function context(overrides: Partial<JobContext> = {}): JobContext {
  const env = { DB: {} as D1Database, DEMO_MODE: "true", TIMEZONE: "Europe/London" };
  const config = readConfig(env);
  return {
    store: new Store(createTestD1()),
    providers: buildProviders(env, config, undefined, () => NOW),
    config,
    now: NOW,
    sender: null,
    ...overrides,
  };
}

async function addEndpoint(store: Store) {
  await store.upsertEndpoint({
    id: "api", name: "API", url: "https://api.example.com/health", expectedStatus: null, keyword: null,
    timeoutMs: 5000, checkTls: true, failureThreshold: 2, recoveryThreshold: 1, status: "unknown",
    consecutiveFailures: 0, consecutiveSuccesses: 0, lastCheckedAt: null, lastLatencyMs: null, createdAt: T0,
  });
}

describe("uptime job", () => {
  it("records checks and opens and resolves incidents", async () => {
    const uptime = new ScriptedUptime([
      { ok: true, statusCode: 200, latencyMs: 80, error: null },
      { ok: false, statusCode: 503, latencyMs: 90, error: "HTTP 503" },
      { ok: false, statusCode: 503, latencyMs: 95, error: "HTTP 503" },
      { ok: true, statusCode: 200, latencyMs: 70, error: null },
    ]);
    const base = context();
    const providers: Providers = { ...base.providers, uptime };
    await addEndpoint(base.store);
    for (let i = 0; i < 4; i++) {
      const ctx = { ...base, providers, now: new Date(NOW.getTime() + i * 300_000) };
      const [outcome] = await runJobs(ctx, ["uptime"]);
      expect(outcome?.ok).toBe(true);
      if (i === 2) {
        expect((await base.store.getEndpoint("api"))?.status).toBe("down");
        expect(await base.store.openIncidentFor("api")).toMatchObject({ cause: "HTTP 503", failureCount: 2 });
      }
    }
    const endpoint = await base.store.getEndpoint("api");
    expect(endpoint).toMatchObject({ status: "up", lastLatencyMs: 70, consecutiveSuccesses: 1 });
    const incidents = await base.store.listIncidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ endpointName: "API", startedAt: "2026-10-30T09:10:00.000Z", resolvedAt: "2026-10-30T09:15:00.000Z" });
    const checks = await base.store.checksSince("api", T0);
    expect(checks.map((c) => c.ok)).toEqual([true, false, false, true]);
    const events = await base.store.eventsSince(T0);
    expect(events.map((e) => e.kind)).toEqual(["incident_opened", "incident_resolved"]);
  });
});

describe("collection jobs with demo providers", () => {
  it("collects reviews idempotently, versions, expiries and Supabase state", async () => {
    const ctx = context();
    await ctx.store.upsertApp({ id: "tidewatch", name: "Tidewatch", appstoreId: "1", playPackage: "com.example.tidewatch", createdAt: T0 });
    await addEndpoint(ctx.store);
    const outcomes = await runJobs(ctx, ["reviews", "versions", "expiries", "supabase"]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    const unread = await ctx.store.countUnreadReviews();
    expect(unread).toBeGreaterThan(5);
    await runJobs(ctx, ["reviews"]);
    expect(await ctx.store.countUnreadReviews()).toBe(unread);

    const releases = await ctx.store.listReleases();
    expect(releases.some((r) => r.source === "appstore" && r.version === "3.4.0")).toBe(true);
    const expiries = await ctx.store.listExpiries();
    expect(expiries.some((e) => e.id === "tls:api.example.com")).toBe(true);
    expect(expiries.some((e) => e.id.startsWith("asc-profile:"))).toBe(true);
    expect(await ctx.store.listSupabaseProjects()).toHaveLength(3);
  });

  it("records failures per job without stopping the others", async () => {
    const base = context();
    await base.store.upsertApp({ id: "x", name: "X", appstoreId: "1", playPackage: null, createdAt: T0 });
    const broken: Providers = {
      ...base.providers,
      stores: [{ name: "appstore", handles: () => true, fetchReviews: async () => { throw new Error("401 bad key"); }, fetchVersions: async () => [] }],
    };
    const outcomes = await runJobs({ ...base, providers: broken }, ["reviews", "supabase"]);
    expect(outcomes[0]).toMatchObject({ job: "reviews", ok: false });
    expect(outcomes[0]?.error).toContain("401 bad key");
    expect(outcomes[1]).toMatchObject({ job: "supabase", ok: true });
    const runs = await base.store.listJobRuns();
    expect(runs.find((r) => r.job === "reviews")).toMatchObject({ lastOk: false });
  });

  it("logs release state changes and Supabase status changes as events", async () => {
    const ctx = context();
    await ctx.store.upsertApp({ id: "tidewatch", name: "Tidewatch", appstoreId: "1", playPackage: null, createdAt: T0 });
    await runJobs(ctx, ["versions", "supabase"]);
    expect(await ctx.store.eventsSince(T0)).toHaveLength(0);
    const later = { ...ctx, now: new Date(NOW.getTime() + 3_600_000) };
    const providers: Providers = {
      ...ctx.providers,
      stores: [{
        name: "appstore", handles: () => true, fetchReviews: async () => [],
        fetchVersions: async () => [{ key: "v340", platform: "ios", version: "3.4.0", state: "in review", releaseDate: "2026-11-04" }],
      }],
      supabase: { fetchProjects: async () => [{ ref: "demoprojsignalbx03", name: "signal-box-staging", region: null, status: "ACTIVE_HEALTHY", services: [], dbSizeBytes: null }] },
    };
    await runJobs({ ...later, providers }, ["versions", "supabase"]);
    const events = await ctx.store.eventsSince(T0);
    expect(events.map((e) => [e.kind, e.detail])).toEqual([
      ["release_state", "waiting for review to in review"],
      ["supabase_status", "INACTIVE to ACTIVE_HEALTHY"],
    ]);
  });
});

describe("digest job and scheduled tick", () => {
  it("sends once per day and records the result", async () => {
    const sent: DigestPreview[] = [];
    const ctx = context({ sender: { name: "test", send: async (d) => void sent.push(d) } });
    await seedDemo(ctx);
    const first = await runScheduledTick(ctx);
    expect(first.map((o) => o.job)).toContain("digest");
    expect(first.every((o) => o.ok)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toMatch(/^Lighthouse: /);
    expect(sent[0]?.text).toContain("Reviews");

    const second = await runScheduledTick({ ...ctx, now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(second.map((o) => o.job)).toEqual(["uptime"]);
    expect(sent).toHaveLength(1);
  });

  it("records a misconfigured provider as a failure", async () => {
    const ctx = context({ sender: { error: "DIGEST_WEBHOOK_URL is not set" } });
    const [outcome] = await runJobs(ctx, ["digest"]);
    expect(outcome).toMatchObject({ ok: false, error: "DIGEST_WEBHOOK_URL is not set" });
    expect((await ctx.store.lastDigest())?.delivered).toBe(false);
  });
});

describe("demo seed", () => {
  it("fills an empty database once with a day of history", async () => {
    const ctx = context();
    expect(await seedDemo(ctx)).toBe(true);
    expect(await seedDemo(ctx)).toBe(false);
    expect(await ctx.store.listApps()).toHaveLength(3);
    const endpoints = await ctx.store.listEndpoints();
    expect(endpoints).toHaveLength(4);
    expect(endpoints.every((e) => e.lastCheckedAt !== null)).toBe(true);
    const checks = await ctx.store.checksSince("sync-worker", "2026-10-29T00:00:00Z");
    expect(checks.length).toBe(288);
    expect((await ctx.store.listIncidents({ endpointId: "sync-worker" })).length).toBeGreaterThan(0);
    // Older reviews are pre-read so the unread count stays meaningful.
    const stats = await ctx.store.reviewStats(NOW);
    expect(stats.unread).toBeGreaterThan(0);
    expect(stats.unread).toBeLessThan(15);
  });
});
