// The JSON API used by the front end. Every route except health, session,
// login and logout requires authentication (see ../auth.ts).

import {
  authMode,
  createSessionToken,
  isAuthenticated,
  LoginThrottle,
  passphraseMatches,
  sessionCookie,
} from "../auth";
import type { AppContext } from "../context";
import { seedDemo } from "../demo/seed";
import { digestSinceLast } from "../digest/collect";
import { buildExpiryList } from "../expiry";
import { slugify, randomId } from "../lib/ids";
import { DAY, iso, localDate } from "../lib/time";
import { runJobs } from "../jobs";
import { buildOverview } from "../overview";
import { advancePast } from "../providers/manual";
import { providerStatus } from "../providers/registry";
import type { JobName } from "../scheduler";
import type {
  App,
  Endpoint,
  EndpointSummary,
  ExpiryKind,
  Platform,
  Release,
  ReleasePlatform,
  Reminder,
  RepeatRule,
  SessionInfo,
} from "../shared/types";
import { errorResponse, HttpError, json, readJson, Router } from "./http";
import {
  APPSTORE_ID,
  calendarDate,
  httpUrl,
  oneOf,
  optionalInt,
  optionalString,
  PLAY_PACKAGE,
  requiredString,
  stringArray,
} from "./validate";

const EXPIRY_KINDS = ["certificate", "profile", "tls", "domain", "agreement", "membership", "other"] as const satisfies readonly ExpiryKind[];
const REPEAT_RULES = ["none", "monthly", "yearly"] as const satisfies readonly RepeatRule[];
const RELEASE_PLATFORMS = ["ios", "android", "web", "other"] as const satisfies readonly ReleasePlatform[];
const RUNNABLE_JOBS = ["uptime", "reviews", "supabase", "versions", "expiries", "maintenance"] as const satisfies readonly JobName[];

export const READ_ONLY_MESSAGE = "This is a read-only demo, so changes are switched off. Run Lighthouse yourself to try them.";

const PUBLIC_ROUTES = new Set(["GET /api/health", "GET /api/session", "POST /api/login", "POST /api/logout"]);

const throttle = new LoginThrottle();
let demoSeeded: Promise<unknown> | null = null;

const router = new Router<AppContext>();

// ---- session ---------------------------------------------------------------------

router.add("GET", "/api/health", async () => json({ ok: true }));

router.add("GET", "/api/session", async (ctx, _p, request) => {
  const info: SessionInfo = {
    authMode: authMode(ctx.env, ctx.config),
    authenticated: await isAuthenticated(request, ctx.env, ctx.config, ctx.fetcher, ctx.now),
    demo: ctx.config.demo,
    readOnly: ctx.config.publicDemo,
  };
  return json(info);
});

router.add("POST", "/api/login", async (ctx, _p, request, url) => {
  if (authMode(ctx.env, ctx.config) !== "passphrase") throw new HttpError(400, "Passphrase login is not enabled");
  const client = request.headers.get("cf-connecting-ip") ?? "local";
  const nowMs = ctx.now.getTime();
  if (throttle.blocked(client, nowMs)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
  const body = await readJson(request);
  const submitted = typeof body.passphrase === "string" ? body.passphrase : "";
  const ok = await passphraseMatches(submitted, ctx.env.LIGHTHOUSE_PASSPHRASE!, ctx.env.SESSION_SECRET!);
  if (!ok) {
    throttle.fail(client, nowMs);
    throw new HttpError(401, "That passphrase is not right");
  }
  throttle.succeed(client);
  const token = await createSessionToken(ctx.env.SESSION_SECRET!, ctx.env.LIGHTHOUSE_PASSPHRASE!, ctx.now);
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie(token, url.protocol === "https:") } });
});

router.add("POST", "/api/logout", async (_ctx, _p, _r, url) =>
  json({ ok: true }, { headers: { "set-cookie": sessionCookie("", url.protocol === "https:", 0) } }),
);

// ---- overview and settings -----------------------------------------------------------

router.add("GET", "/api/overview", async (ctx) =>
  json(await buildOverview(ctx.store, { now: ctx.now, timeZone: ctx.config.timeZone, demo: ctx.config.demo })),
);

router.add("GET", "/api/settings", async (ctx) => {
  const sender = ctx.sender;
  return json({
    demo: ctx.config.demo,
    readOnly: ctx.config.publicDemo,
    authMode: authMode(ctx.env, ctx.config),
    timeZone: ctx.config.timeZone,
    providers: providerStatus(ctx.env, ctx.config),
    digest: {
      provider: ctx.config.digest.provider,
      hour: ctx.config.digest.hour,
      problem: sender && "error" in sender ? sender.error : null,
      last: await ctx.store.lastDigest(),
    },
    keepReviewerNames: ctx.config.keepReviewerNames,
    checkRetentionDays: ctx.config.checkRetentionDays,
    jobs: await ctx.store.listJobRuns(),
  });
});

router.add("POST", "/api/run", async (ctx, _p, request) => {
  const body = await readJson(request);
  const jobs = body.jobs === undefined ? [...RUNNABLE_JOBS] : stringArray(body, "jobs", 10, 20);
  for (const j of jobs) {
    if (!(RUNNABLE_JOBS as readonly string[]).includes(j)) throw new HttpError(400, `Unknown job: ${j}`);
  }
  return json({ outcomes: await runJobs(ctx, jobs as JobName[]) });
});

// ---- apps and reviews -----------------------------------------------------------------

router.add("GET", "/api/apps", async (ctx) => json(await ctx.store.listApps()));

router.add("POST", "/api/apps", async (ctx, _p, request) => {
  const body = await readJson(request);
  const name = requiredString(body, "name", 80);
  const appstoreId = optionalString(body, "appstoreId", 15);
  const playPackage = optionalString(body, "playPackage", 150);
  if (appstoreId && !APPSTORE_ID.test(appstoreId)) throw new HttpError(400, "appstoreId is the numeric Apple ID of the app");
  if (playPackage && !PLAY_PACKAGE.test(playPackage)) throw new HttpError(400, "playPackage looks like com.example.app");
  let id = typeof body.id === "string" && body.id ? body.id : slugify(name);
  const existing = await ctx.store.getApp(id);
  if (existing && body.id === undefined) id = `${id}-${randomId("x").slice(2, 6)}`;
  const app: App = { id, name, appstoreId, playPackage, createdAt: existing?.createdAt ?? iso(ctx.now) };
  await ctx.store.upsertApp(app);
  return json(app, { status: existing ? 200 : 201 });
});

router.add("DELETE", "/api/apps/:id", async (ctx, p) => {
  if (!(await ctx.store.deleteApp(p.id!))) throw new HttpError(404, "No such app");
  return json({ ok: true });
});

router.add("GET", "/api/reviews", async (ctx, _p, _r, url) => {
  const q = url.searchParams;
  const ratings = (q.get("stars") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  const platform = q.get("platform");
  const page = await ctx.store.listReviews({
    appId: q.get("app") || undefined,
    platform: platform === "ios" || platform === "android" ? (platform as Platform) : undefined,
    ratings,
    unreadOnly: q.get("unread") === "1",
    cursor: q.get("cursor") || undefined,
    limit: Number(q.get("limit")) || 50,
  });
  return json({ ...page, unreadTotal: await ctx.store.countUnreadReviews() });
});

router.add("POST", "/api/reviews/read", async (ctx, _p, request) => {
  const body = await readJson(request);
  if (body.all === true) {
    const appId = optionalString(body, "app", 64) ?? undefined;
    return json({ changed: await ctx.store.markAllReviewsRead(iso(ctx.now), appId) });
  }
  const ids = stringArray(body, "ids", 200, 200);
  const changed = body.read === false ? await ctx.store.markReviewsUnread(ids) : await ctx.store.markReviewsRead(ids, iso(ctx.now));
  return json({ changed });
});

// ---- uptime -------------------------------------------------------------------------------

async function endpointSummaries(ctx: AppContext): Promise<EndpointSummary[]> {
  const since24h = iso(new Date(ctx.now.getTime() - DAY));
  const [endpoints, up24, up7] = await Promise.all([
    ctx.store.listEndpoints(),
    ctx.store.uptimeSince(since24h),
    ctx.store.uptimeSince(iso(new Date(ctx.now.getTime() - 7 * DAY))),
  ]);
  return Promise.all(
    endpoints.map(async (e) => ({
      ...e,
      uptime24h: up24.get(e.id) ?? null,
      uptime7d: up7.get(e.id) ?? null,
      recent: await ctx.store.checksSince(e.id, since24h),
      openIncident: await ctx.store.openIncidentFor(e.id),
    })),
  );
}

router.add("GET", "/api/endpoints", async (ctx) => json(await endpointSummaries(ctx)));

router.add("GET", "/api/endpoints/:id/checks", async (ctx, p, _r, url) => {
  const endpoint = await ctx.store.getEndpoint(p.id!);
  if (!endpoint) throw new HttpError(404, "No such endpoint");
  const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 24, 1), 24 * 30);
  const checks = await ctx.store.checksSince(endpoint.id, iso(new Date(ctx.now.getTime() - hours * 3600_000)));
  const incidents = await ctx.store.listIncidents({ endpointId: endpoint.id, limit: 20 });
  return json({ endpoint, checks, incidents });
});

router.add("POST", "/api/endpoints", async (ctx, _p, request) => {
  const body = await readJson(request);
  const name = requiredString(body, "name", 80);
  const id = typeof body.id === "string" && body.id ? body.id : slugify(name);
  const existing = await ctx.store.getEndpoint(id);
  if (existing && body.id === undefined) throw new HttpError(409, "An endpoint with that name already exists");
  const endpoint: Endpoint = {
    id,
    name,
    url: httpUrl(body, "url"),
    expectedStatus: optionalInt(body, "expectedStatus", 100, 599, null),
    keyword: optionalString(body, "keyword", 200),
    timeoutMs: optionalInt(body, "timeoutMs", 1000, 30_000, 10_000)!,
    checkTls: body.checkTls !== false,
    failureThreshold: optionalInt(body, "failureThreshold", 1, 10, 2)!,
    recoveryThreshold: optionalInt(body, "recoveryThreshold", 1, 10, 1)!,
    status: existing?.status ?? "unknown",
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
    consecutiveSuccesses: existing?.consecutiveSuccesses ?? 0,
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    lastLatencyMs: existing?.lastLatencyMs ?? null,
    createdAt: existing?.createdAt ?? iso(ctx.now),
  };
  await ctx.store.upsertEndpoint(endpoint);
  return json(endpoint, { status: existing ? 200 : 201 });
});

router.add("DELETE", "/api/endpoints/:id", async (ctx, p) => {
  if (!(await ctx.store.deleteEndpoint(p.id!))) throw new HttpError(404, "No such endpoint");
  // Its TLS expiry disappears on the next daily expiry check.
  return json({ ok: true });
});

router.add("GET", "/api/incidents", async (ctx, _p, _r, url) =>
  json(await ctx.store.listIncidents({ limit: Number(url.searchParams.get("limit")) || 50 })),
);

// ---- expiries and reminders -----------------------------------------------------------------

router.add("GET", "/api/expiries", async (ctx) => {
  const [stored, reminders] = await Promise.all([ctx.store.listExpiries(), ctx.store.listReminders()]);
  return json(buildExpiryList(stored, reminders, ctx.now, ctx.config.timeZone));
});

router.add("GET", "/api/reminders", async (ctx) => json(await ctx.store.listReminders()));

router.add("POST", "/api/reminders", async (ctx, _p, request) => {
  const body = await readJson(request);
  const id = optionalString(body, "id", 64);
  const existing = id ? await ctx.store.getReminder(id) : null;
  if (id && !existing) throw new HttpError(404, "No such reminder");
  const reminder: Reminder = {
    id: existing?.id ?? randomId("rem"),
    title: requiredString(body, "title", 120),
    kind: oneOf(body, "kind", EXPIRY_KINDS, "other"),
    dueOn: calendarDate(body, "dueOn", true)!,
    repeat: oneOf(body, "repeat", REPEAT_RULES, "none"),
    notes: optionalString(body, "notes", 500),
    createdAt: existing?.createdAt ?? iso(ctx.now),
  };
  await ctx.store.upsertReminder(reminder);
  return json(reminder, { status: existing ? 200 : 201 });
});

/** Mark a reminder done: repeating ones roll forward, one-offs are removed. */
router.add("POST", "/api/reminders/:id/done", async (ctx, p) => {
  const reminder = await ctx.store.getReminder(p.id!);
  if (!reminder) throw new HttpError(404, "No such reminder");
  const next = advancePast(reminder.dueOn, reminder.repeat, localDate(ctx.now, ctx.config.timeZone));
  if (next) {
    await ctx.store.upsertReminder({ ...reminder, dueOn: next });
    return json({ ...reminder, dueOn: next });
  }
  await ctx.store.deleteReminder(reminder.id);
  return json({ deleted: true });
});

router.add("DELETE", "/api/reminders/:id", async (ctx, p) => {
  if (!(await ctx.store.deleteReminder(p.id!))) throw new HttpError(404, "No such reminder");
  return json({ ok: true });
});

// ---- releases --------------------------------------------------------------------------------

router.add("GET", "/api/releases", async (ctx, _p, _r, url) => {
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  return json(await ctx.store.listReleases({ from, to }));
});

router.add("POST", "/api/releases", async (ctx, _p, request) => {
  const body = await readJson(request);
  const id = optionalString(body, "id", 64);
  const existing = id ? await ctx.store.getRelease(id) : null;
  if (id && !existing) throw new HttpError(404, "No such release");
  if (existing && existing.source !== "manual") throw new HttpError(400, "Releases from the stores are read-only");
  const appId = optionalString(body, "appId", 64);
  if (appId && !(await ctx.store.getApp(appId))) throw new HttpError(400, "Unknown app");
  const release: Release = {
    id: existing?.id ?? randomId("rel"),
    appId,
    platform: oneOf(body, "platform", RELEASE_PLATFORMS, "ios"),
    version: requiredString(body, "version", 60),
    state: optionalString(body, "state", 40) ?? "planned",
    releaseDate: calendarDate(body, "releaseDate", false),
    source: "manual",
    notes: optionalString(body, "notes", 500),
    updatedAt: iso(ctx.now),
  };
  await ctx.store.upsertRelease(release);
  return json(release, { status: existing ? 200 : 201 });
});

router.add("DELETE", "/api/releases/:id", async (ctx, p) => {
  const release = await ctx.store.getRelease(p.id!);
  if (!release) throw new HttpError(404, "No such release");
  if (release.source !== "manual") throw new HttpError(400, "Releases from the stores are read-only");
  await ctx.store.deleteRelease(release.id);
  return json({ ok: true });
});

// ---- supabase and digest -------------------------------------------------------------------------

router.add("GET", "/api/supabase", async (ctx) => json(await ctx.store.listSupabaseProjects()));

router.add("GET", "/api/digest/preview", async (ctx) => {
  const { digest, since } = await digestSinceLast(ctx.store, {
    now: ctx.now,
    timeZone: ctx.config.timeZone,
    dashboardUrl: ctx.config.dashboardUrl,
  });
  return json({ ...digest, since: iso(since) });
});

/** Send the current digest now, without marking it as the daily one. */
router.add("POST", "/api/digest/test", async (ctx) => {
  const sender = ctx.sender;
  if (sender === null) throw new HttpError(400, "No digest provider is configured (DIGEST_PROVIDER is none)");
  if ("error" in sender) throw new HttpError(400, sender.error);
  const { digest } = await digestSinceLast(ctx.store, {
    now: ctx.now,
    timeZone: ctx.config.timeZone,
    dashboardUrl: ctx.config.dashboardUrl,
  });
  try {
    await sender.send({ ...digest, subject: `[Test] ${digest.subject}` });
  } catch (err) {
    throw new HttpError(502, `The ${sender.name} provider failed: ${(err as Error).message}`);
  }
  return json({ ok: true, provider: sender.name });
});

// ---- entry point ------------------------------------------------------------------------------------

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Same-origin fetches from older browsers and curl send none.
  return origin === url.origin;
}

export async function handleApi(request: Request, ctx: AppContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  try {
    const match = router.match(method, url.pathname);
    if (match === null) return errorResponse(404, "Not found");
    if (match === "method") return errorResponse(405, "Method not allowed");

    if (method !== "GET" && method !== "HEAD" && !sameOrigin(request, url)) {
      return errorResponse(403, "Cross-origin request refused");
    }
    if (ctx.config.publicDemo && method !== "GET" && method !== "HEAD") {
      return errorResponse(403, READ_ONLY_MESSAGE);
    }
    if (!PUBLIC_ROUTES.has(`${method} ${url.pathname}`)) {
      if (!(await isAuthenticated(request, ctx.env, ctx.config, ctx.fetcher, ctx.now))) {
        const mode = authMode(ctx.env, ctx.config);
        return errorResponse(401, mode === "unconfigured" ? "Authentication is not configured. See the README." : "Sign in required");
      }
    }
    if (ctx.config.demo) {
      demoSeeded ??= seedDemo(ctx).catch((err) => {
        demoSeeded = null;
        throw err;
      });
      await demoSeeded;
    }
    return await match.handler(ctx, match.params, request, url);
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.message);
    console.error("API error", err);
    return errorResponse(500, "Something went wrong. The Worker logs have the details.");
  }
}

/** For tests: forget that demo data was seeded in this isolate. */
export function resetDemoSeed(): void {
  demoSeeded = null;
}

