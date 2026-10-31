// The work each scheduled job does. Jobs talk to providers through the
// interfaces in providers/types.ts and to D1 through the Store.

import type { Config } from "./env";
import type { Store } from "./db/store";
import { evaluateCheck } from "./incidents";
import { DAY, iso, localDate } from "./lib/time";
import type { Providers } from "./providers/types";
import type { DigestSender } from "./digest/send";
import { digestSinceLast } from "./digest/collect";
import { dueJobs, type JobName } from "./scheduler";

export interface JobContext {
  store: Store;
  providers: Providers;
  config: Config;
  now: Date;
  /** null when no digest provider is configured; an error object when misconfigured. */
  sender: DigestSender | null | { error: string };
}

export interface JobOutcome {
  job: JobName;
  ok: boolean;
  summary: string;
  error: string | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runUptime(ctx: JobContext): Promise<string> {
  const { store, providers, now } = ctx;
  const endpoints = await store.listEndpoints();
  const at = iso(now);
  const results = await Promise.all(
    endpoints.map((e) =>
      providers.uptime
        .probe({ url: e.url, timeoutMs: e.timeoutMs, expectedStatus: e.expectedStatus, keyword: e.keyword })
        .catch((err) => ({ ok: false, statusCode: null, latencyMs: null, error: message(err) })),
    ),
  );
  let down = 0;
  for (const [i, endpoint] of endpoints.entries()) {
    const result = results[i]!;
    await store.insertCheck(endpoint.id, at, result);
    const open = await store.openIncidentFor(endpoint.id);
    const { next, action } = evaluateCheck(endpoint, result, endpoint, open !== null);
    switch (action.type) {
      case "open":
        await store.openIncident(endpoint.id, at, action.cause, action.failureCount);
        await store.addEvent(at, "incident_opened", endpoint.name, action.cause);
        break;
      case "update":
        if (open) await store.updateIncidentFailures(open.id, action.failureCount, action.cause);
        break;
      case "resolve":
        if (open) {
          await store.resolveIncident(open.id, at);
          await store.addEvent(at, "incident_resolved", endpoint.name, null);
        }
        break;
      case "none":
        break;
    }
    if (next.status === "down") down++;
    await store.saveEndpointState(endpoint.id, { ...next, lastCheckedAt: at, lastLatencyMs: result.latencyMs });
  }
  return `${endpoints.length} checked, ${down} down`;
}

export async function runReviews(ctx: JobContext): Promise<string> {
  const { store, providers, now, config } = ctx;
  const apps = await store.listApps();
  const errors: string[] = [];
  let added = 0;
  for (const app of apps) {
    for (const provider of providers.stores) {
      if (!provider.handles(app)) continue;
      try {
        const reviews = await provider.fetchReviews(app);
        added += await store.insertReviews(app.id, reviews, iso(now), config.keepReviewerNames);
      } catch (err) {
        errors.push(`${app.name} (${provider.name}): ${message(err)}`);
      }
    }
  }
  if (errors.length) throw new Error(`${added} new; ${errors.join("; ")}`);
  return `${added} new`;
}

export async function runVersions(ctx: JobContext): Promise<string> {
  const { store, providers, now } = ctx;
  const apps = await store.listApps();
  const errors: string[] = [];
  let changed = 0;
  for (const app of apps) {
    for (const provider of providers.stores) {
      if (!provider.handles(app)) continue;
      try {
        const versions = await provider.fetchVersions(app);
        const changes = await store.syncStoreVersions(provider.name, app.id, versions, iso(now));
        for (const c of changes) {
          // Only log state changes, not the first sighting of an old version.
          if (c.previousState !== null) {
            await store.addEvent(
              iso(now),
              "release_state",
              `${app.name} ${c.version.version} (${c.version.platform})`,
              `${c.previousState} to ${c.version.state}`,
            );
          }
        }
        changed += changes.length;
      } catch (err) {
        errors.push(`${app.name} (${provider.name}): ${message(err)}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
  return `${changed} updated`;
}

export async function runExpiries(ctx: JobContext): Promise<string> {
  const { store, providers, now } = ctx;
  const at = iso(now);
  const errors: string[] = [];
  let count = 0;

  if (providers.signing) {
    try {
      const items = await providers.signing.fetchExpiries();
      await store.replaceExpiries("appstore", items, at);
      count += items.length;
    } catch (err) {
      errors.push(`App Store: ${message(err)}`);
    }
  }

  if (providers.tls) {
    const endpoints = (await store.listEndpoints()).filter((e) => e.checkTls && e.url.startsWith("https://"));
    const hosts = [...new Set(endpoints.map((e) => new URL(e.url).hostname))];
    const previous = new Map((await store.listExpiries()).filter((e) => e.source === "tls").map((e) => [e.id, e]));
    const items = [];
    for (const host of hosts) {
      const id = `tls:${host}`;
      try {
        const cert = await providers.tls.lookup(host);
        if (cert) {
          items.push({ id, kind: "tls" as const, label: `TLS certificate for ${host}`, expiresAt: cert.notAfter, detail: cert.issuer });
        }
      } catch (err) {
        // Keep the last known value rather than dropping the row.
        const old = previous.get(id);
        if (old) items.push(old);
        errors.push(`TLS ${host}: ${message(err)}`);
      }
    }
    await store.replaceExpiries("tls", items, at);
    count += items.length;
  }

  if (errors.length) throw new Error(errors.join("; "));
  return `${count} tracked`;
}

export async function runSupabase(ctx: JobContext): Promise<string> {
  const { store, providers, now } = ctx;
  if (!providers.supabase) return "not configured";
  const projects = await providers.supabase.fetchProjects();
  const previous = await store.replaceSupabaseProjects(projects, iso(now));
  const before = new Map(previous.map((p) => [p.ref, p.status]));
  for (const p of projects) {
    const old = before.get(p.ref);
    if (old !== undefined && old !== p.status) {
      await store.addEvent(iso(now), "supabase_status", `Supabase project ${p.name}`, `${old} to ${p.status}`);
    }
  }
  return `${projects.length} projects`;
}

export async function runMaintenance(ctx: JobContext): Promise<string> {
  const { store, now, config } = ctx;
  const removed = await store.pruneChecks(iso(new Date(now.getTime() - config.checkRetentionDays * DAY)));
  await store.pruneEvents(iso(new Date(now.getTime() - 60 * DAY)));
  return `${removed} old checks removed`;
}

export async function runDigest(ctx: JobContext): Promise<string> {
  const { store, now, config, sender } = ctx;
  const today = localDate(now, config.timeZone);
  const { digest } = await digestSinceLast(store, { now, timeZone: config.timeZone, dashboardUrl: config.dashboardUrl });
  if (sender === null) {
    await store.recordDigest(iso(now), today, "none", false, digest.subject);
    return "no provider configured";
  }
  if ("error" in sender) {
    await store.recordDigest(iso(now), today, "misconfigured", false, digest.subject);
    throw new Error(sender.error);
  }
  try {
    await sender.send(digest);
  } catch (err) {
    // Record the attempt so a broken provider does not retry every five minutes.
    await store.recordDigest(iso(now), today, sender.name, false, digest.subject);
    throw err;
  }
  await store.recordDigest(iso(now), today, sender.name, true, digest.subject);
  return digest.subject;
}

const RUNNERS: Record<JobName, (ctx: JobContext) => Promise<string>> = {
  uptime: runUptime,
  reviews: runReviews,
  supabase: runSupabase,
  versions: runVersions,
  expiries: runExpiries,
  maintenance: runMaintenance,
  digest: runDigest,
};

/** Run the given jobs one after another, recording each outcome. */
export async function runJobs(ctx: JobContext, jobs: JobName[]): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (const job of jobs) {
    try {
      const summary = await RUNNERS[job](ctx);
      await ctx.store.recordJobRun(job, iso(ctx.now), true, null);
      outcomes.push({ job, ok: true, summary, error: null });
    } catch (err) {
      const error = message(err).slice(0, 500);
      await ctx.store.recordJobRun(job, iso(ctx.now), false, error);
      outcomes.push({ job, ok: false, summary: "", error });
    }
  }
  return outcomes;
}

/** Entry point for the cron trigger: work out what is due and run it. */
export async function runScheduledTick(ctx: JobContext): Promise<JobOutcome[]> {
  const [runs, lastDigest] = await Promise.all([ctx.store.listJobRuns(), ctx.store.lastDigest()]);
  const lastRuns = Object.fromEntries(runs.map((r) => [r.job, new Date(r.lastRunAt)]));
  const jobs = dueJobs(
    ctx.now,
    { lastRuns, lastDigestDate: lastDigest?.localDate ?? null },
    { timeZone: ctx.config.timeZone, digestHour: ctx.config.digest.hour, digestEnabled: true },
  );
  return runJobs(ctx, jobs);
}
