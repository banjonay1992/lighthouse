// Decides which jobs are due. One cron trigger fires every five minutes;
// rather than one trigger per job, each job has an interval and the time it
// last ran is stored. This copes with missed or delayed ticks and keeps the
// wrangler config to a single trigger.

import { localDate, localHour, MINUTE, HOUR } from "./lib/time";

export type JobName = "uptime" | "reviews" | "supabase" | "versions" | "expiries" | "maintenance" | "digest";

export const JOB_INTERVALS: Record<Exclude<JobName, "digest">, number> = {
  uptime: 5 * MINUTE,
  reviews: HOUR,
  supabase: HOUR,
  versions: 6 * HOUR,
  expiries: 24 * HOUR,
  maintenance: 24 * HOUR,
};

/** Cron ticks drift by a few seconds; allow some slack so a job is not skipped a whole cycle. */
const SLACK = 90_000;

export interface ScheduleState {
  lastRuns: Partial<Record<JobName, Date>>;
  /** Local calendar date of the last digest, if any. */
  lastDigestDate: string | null;
}

export interface ScheduleOptions {
  timeZone: string;
  digestHour: number;
  digestEnabled: boolean;
}

export function dueJobs(now: Date, state: ScheduleState, options: ScheduleOptions): JobName[] {
  const due: JobName[] = [];
  for (const [job, interval] of Object.entries(JOB_INTERVALS) as [Exclude<JobName, "digest">, number][]) {
    const last = state.lastRuns[job];
    if (!last || now.getTime() - last.getTime() >= interval - SLACK) due.push(job);
  }
  if (options.digestEnabled && localHour(now, options.timeZone) >= options.digestHour) {
    const today = localDate(now, options.timeZone);
    if (state.lastDigestDate !== today) due.push("digest");
  }
  return due;
}
