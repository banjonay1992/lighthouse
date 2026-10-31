// Gathers digest input from the database. Shared by the scheduled digest
// job and the preview endpoint.

import type { Store } from "../db/store";
import { buildExpiryList } from "../expiry";
import { DAY, iso, localDate } from "../lib/time";
import { buildDigest, type DigestInput } from "./build";
import type { DigestPreview } from "../shared/types";

export async function collectDigestInput(
  store: Store,
  options: { now: Date; since: Date; timeZone: string; dashboardUrl: string | null },
): Promise<DigestInput> {
  const { now, since, timeZone } = options;
  const sinceIso = iso(since);
  const today = localDate(now, timeZone);
  const weekAhead = localDate(new Date(now.getTime() + 7 * DAY), timeZone);
  const [apps, newReviews, incidents, stored, reminders, releases, events, supabase] = await Promise.all([
    store.listApps(),
    store.reviewsFetchedSince(sinceIso),
    store.listIncidents({ since: sinceIso, limit: 50 }),
    store.listExpiries(),
    store.listReminders(),
    store.listReleases({ from: today, to: weekAhead }),
    store.eventsSince(sinceIso),
    store.listSupabaseProjects(),
  ]);
  return {
    now,
    since,
    timeZone,
    dashboardUrl: options.dashboardUrl,
    apps,
    newReviews,
    incidents,
    expiries: buildExpiryList(stored, reminders, now, timeZone),
    upcomingReleases: releases.filter((r) => r.releaseDate !== null && r.state !== "live"),
    events,
    supabase,
  };
}

/** Build a digest covering everything since the last one (or the last day). */
export async function digestSinceLast(
  store: Store,
  options: { now: Date; timeZone: string; dashboardUrl: string | null },
): Promise<{ digest: DigestPreview; since: Date }> {
  const last = await store.lastDigest();
  const since = last ? new Date(last.sentAt) : new Date(options.now.getTime() - DAY);
  const input = await collectDigestInput(store, { ...options, since });
  return { digest: buildDigest(input), since };
}
