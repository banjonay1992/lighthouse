// The overview: a short list of things that need attention plus quiet
// counts for everything else. The rule is that nothing appears in
// "attention" unless it is worth acting on.

import type { Store } from "./db/store";
import { buildExpiryList } from "./expiry";
import { formatDuration } from "./incidents";
import { DAY, localDate, MINUTE } from "./lib/time";
import type { AttentionItem, Overview } from "./shared/types";
import { supabaseStatus } from "./shared/labels";

const JOB_LABELS: Record<string, string> = {
  uptime: "Uptime checks",
  reviews: "Review collection",
  supabase: "Supabase check",
  versions: "Store version sync",
  expiries: "Expiry check",
  maintenance: "Maintenance",
  digest: "Daily digest",
};

export async function buildOverview(store: Store, options: { now: Date; timeZone: string; demo: boolean }): Promise<Overview> {
  const { now, timeZone } = options;
  const today = localDate(now, timeZone);
  const twoWeeks = localDate(new Date(now.getTime() + 14 * DAY), timeZone);
  const [reviewStats, endpoints, stored, reminders, releases, projects, jobs] = await Promise.all([
    store.reviewStats(now),
    store.listEndpoints(),
    store.listExpiries(),
    store.listReminders(),
    store.listReleases({ from: today, to: twoWeeks }),
    store.listSupabaseProjects(),
    store.listJobRuns(),
  ]);
  const expiries = buildExpiryList(stored, reminders, now, timeZone);
  const attention: AttentionItem[] = [];

  for (const e of endpoints.filter((e) => e.status === "down")) {
    const open = await store.openIncidentFor(e.id);
    const since = open ? ` for ${formatDuration(now.getTime() - Date.parse(open.startedAt))}` : "";
    attention.push({ level: "critical", area: "uptime", message: `${e.name} is down${since}`, href: `#/uptime/${e.id}` });
  }

  for (const x of expiries.filter((x) => x.severity === "expired" || x.severity === "urgent")) {
    const days = `${x.daysLeft} day${x.daysLeft === 1 ? "" : "s"}`;
    const when = x.manual
      ? x.daysLeft < 0 ? "is overdue" : x.daysLeft === 0 ? "is due today" : `is due in ${days}`
      : x.daysLeft < 0 ? "has expired" : x.daysLeft === 0 ? "expires today" : `expires in ${days}`;
    attention.push({ level: x.severity === "expired" ? "critical" : "warning", area: "expiries", message: `${x.label} ${when}`, href: "#/expiries" });
  }

  if (reviewStats.lowRatedUnread > 0) {
    const n = reviewStats.lowRatedUnread;
    attention.push({
      level: "warning",
      area: "reviews",
      message: `${n} unread review${n === 1 ? "" : "s"} rated 1 or 2 stars`,
      href: "#/reviews?stars=1,2&unread=1",
    });
  }

  for (const p of projects) {
    if (!p.status.startsWith("ACTIVE")) {
      attention.push({ level: "warning", area: "supabase", message: `Supabase project ${p.name} is ${supabaseStatus(p.status)}`, href: "#/supabase" });
    } else if (p.healthy === false) {
      const bad = p.services.filter((s) => !s.healthy).map((s) => s.name).join(", ");
      attention.push({ level: "warning", area: "supabase", message: `Supabase project ${p.name}: ${bad} unhealthy`, href: "#/supabase" });
    }
  }

  for (const j of jobs.filter((j) => !j.lastOk)) {
    attention.push({ level: "warning", area: "jobs", message: `${JOB_LABELS[j.job] ?? j.job} failed: ${j.lastError ?? "unknown error"}`, href: "#/settings" });
  }
  const uptimeRun = jobs.find((j) => j.job === "uptime");
  if (endpoints.length > 0 && (!uptimeRun || now.getTime() - Date.parse(uptimeRun.lastRunAt) > 30 * MINUTE)) {
    attention.push({
      level: "warning",
      area: "jobs",
      message: uptimeRun
        ? `Scheduled checks have not run for ${formatDuration(now.getTime() - Date.parse(uptimeRun.lastRunAt))}`
        : "Scheduled checks have not run yet",
      href: "#/settings",
    });
  }

  attention.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));

  return {
    generatedAt: now.toISOString(),
    demo: options.demo,
    attention,
    reviews: reviewStats,
    uptime: {
      total: endpoints.length,
      up: endpoints.filter((e) => e.status === "up").length,
      down: endpoints.filter((e) => e.status === "down").length,
      unknown: endpoints.filter((e) => e.status === "unknown").length,
    },
    expiries: {
      within30d: expiries.filter((x) => x.daysLeft <= 30).length,
      next: expiries[0] ?? null,
    },
    releases: { upcoming: releases.filter((r) => r.releaseDate !== null && r.state !== "live").slice(0, 5) },
    supabase: {
      total: projects.length,
      unhealthy: projects.filter((p) => p.healthy === false || !p.status.startsWith("ACTIVE")).length,
    },
    jobs,
  };
}
