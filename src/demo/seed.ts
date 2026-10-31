// Fills an empty database with invented apps, endpoints, reminders and a
// day of uptime history so the dashboard has something to show in demo
// mode. Never runs outside DEMO_MODE.

import type { Store } from "../db/store";
import { evaluateCheck, type EndpointCounters } from "../incidents";
import { runJobs, type JobContext } from "../jobs";
import { addDays, DAY, iso, localDate, MINUTE } from "../lib/time";
import { demoProbe } from "../providers/demo";
import type { Endpoint } from "../shared/types";

const DEMO_APPS = [
  { id: "tidewatch", name: "Tidewatch", appstoreId: "6400000001", playPackage: "com.example.tidewatch" },
  { id: "moorland-notes", name: "Moorland Notes", appstoreId: "6400000002", playPackage: null },
  { id: "signal-box", name: "Signal Box", appstoreId: null, playPackage: "com.example.signalbox" },
];

const DEMO_ENDPOINTS = [
  { id: "tidewatch-api", name: "Tidewatch API", url: "https://api.tidewatch.example.com/health", keyword: '"ok":true' },
  { id: "marketing-site", name: "Studio website", url: "https://www.example.com/", keyword: null },
  { id: "sync-worker", name: "Notes sync worker", url: "https://sync.example.net/ping", keyword: null },
  { id: "hooks-relay", name: "Webhook relay", url: "https://hooks.example.org/health", keyword: null },
];

export const DEMO_RESET_JOB = "demo_reset";

/**
 * A public demo runs for months, but reminders and planned releases are
 * seeded with fixed dates. Once per local day, wipe the invented data and
 * seed it again so the dates stay relative to today. Returns true when the
 * data was reset.
 */
export async function refreshPublicDemo(ctx: JobContext): Promise<boolean> {
  const { store, now } = ctx;
  const runs = await store.listJobRuns();
  const last = runs.find((r) => r.job === DEMO_RESET_JOB);
  const today = localDate(now, ctx.config.timeZone);
  if (last && localDate(new Date(last.lastRunAt), ctx.config.timeZone) === today && !(await store.isEmpty())) return false;
  await store.clearAll();
  await seedDemo(ctx);
  await store.recordJobRun(DEMO_RESET_JOB, iso(now), true, null);
  return true;
}

export async function seedDemo(ctx: JobContext): Promise<boolean> {
  const { store, now } = ctx;
  if (!(await store.isEmpty())) return false;
  const created = iso(addDays(now, -30));
  const today = localDate(now, ctx.config.timeZone);
  const dateIn = (days: number) => localDate(addDays(now, days), ctx.config.timeZone);

  for (const app of DEMO_APPS) await store.upsertApp({ ...app, createdAt: created });

  for (const e of DEMO_ENDPOINTS) {
    await store.upsertEndpoint({
      ...e,
      expectedStatus: null,
      timeoutMs: 10_000,
      checkTls: true,
      failureThreshold: 2,
      recoveryThreshold: 1,
      status: "unknown",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastCheckedAt: null,
      lastLatencyMs: null,
      createdAt: created,
    });
  }

  const reminders = [
    { id: "demo-domain", title: "Renew tidewatch.example.com", kind: "domain" as const, dueOn: dateIn(23), repeat: "yearly" as const, notes: "Registrar auto-renew is off for this one." },
    { id: "demo-agreement", title: "Accept updated Apple Paid Apps agreement", kind: "agreement" as const, dueOn: dateIn(9), repeat: "none" as const, notes: "Banner showing in App Store Connect." },
    { id: "demo-membership", title: "Apple Developer Program membership", kind: "membership" as const, dueOn: dateIn(140), repeat: "yearly" as const, notes: null },
    { id: "demo-play-verify", title: "Play Console developer verification", kind: "other" as const, dueOn: dateIn(52), repeat: "none" as const, notes: null },
  ];
  for (const r of reminders) await store.upsertReminder({ ...r, createdAt: created });

  await store.upsertRelease({ id: "demo-moorland-130", appId: "moorland-notes", platform: "ios", version: "1.3.0", state: "planned", releaseDate: dateIn(12), source: "manual", notes: "Plain text export and tags.", updatedAt: iso(now) });
  await store.upsertRelease({ id: "demo-signal-web", appId: "signal-box", platform: "web", version: "Web beta", state: "planned", releaseDate: dateIn(20), source: "manual", notes: null, updatedAt: iso(now) });
  await store.upsertRelease({ id: "demo-tide-blog", appId: "tidewatch", platform: "other", version: "Winter tides blog post", state: "planned", releaseDate: today, source: "manual", notes: null, updatedAt: iso(now) });

  await backfillUptime(store, await store.listEndpoints(), now);
  await store.recordJobRun("uptime", iso(now), true, null);

  // Collect everything once so reviews, expiries and projects appear.
  await runJobs(ctx, ["reviews", "versions", "expiries", "supabase"]);

  // Older reviews have already been read, so only recent ones stand out.
  const { reviews } = await store.listReviews({ limit: 200 });
  const old = reviews.filter((r) => Date.parse(r.createdAt) < now.getTime() - 2 * DAY).map((r) => r.id);
  await store.markReviewsRead(old, iso(now));
  return true;
}

/** Replay a day of fake probes through the real incident logic. */
async function backfillUptime(store: Store, endpoints: Endpoint[], now: Date): Promise<void> {
  const step = 5 * MINUTE;
  const start = Math.floor((now.getTime() - DAY) / step) * step;
  for (const e of endpoints) {
    let state: EndpointCounters = { status: "unknown", consecutiveFailures: 0, consecutiveSuccesses: 0 };
    let open: { id: number } | null = null;
    let last: { at: string; latencyMs: number | null } | null = null;
    const rows = [];
    for (let t = start; t < now.getTime(); t += step) {
      const at = iso(new Date(t));
      const result = demoProbe(e.url, new Date(t));
      rows.push({ endpointId: e.id, at, ...result });
      const { next, action } = evaluateCheck(state, result, e, open !== null);
      if (action.type === "open") {
        open = { id: await store.openIncident(e.id, at, action.cause, action.failureCount) };
        await store.addEvent(at, "incident_opened", e.name, action.cause);
      } else if (action.type === "update" && open) {
        await store.updateIncidentFailures(open.id, action.failureCount, action.cause);
      } else if (action.type === "resolve" && open) {
        await store.resolveIncident(open.id, at);
        await store.addEvent(at, "incident_resolved", e.name, null);
        open = null;
      }
      state = next;
      last = { at, latencyMs: result.latencyMs };
    }
    await store.insertChecks(rows);
    await store.saveEndpointState(e.id, { ...state, lastCheckedAt: last?.at ?? null, lastLatencyMs: last?.latencyMs ?? null });
  }
}
