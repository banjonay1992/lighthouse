import { describe, expect, it } from "vitest";
import { dueJobs } from "../src/scheduler";

const options = { timeZone: "Europe/London", digestHour: 8, digestEnabled: true };
const at = (s: string) => new Date(s);
const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("scheduling", () => {
  it("runs everything on a fresh install", () => {
    const now = at("2026-10-30T09:00:00Z");
    expect(dueJobs(now, { lastRuns: {}, lastDigestDate: null }, options)).toEqual([
      "uptime",
      "reviews",
      "supabase",
      "versions",
      "expiries",
      "maintenance",
      "digest",
    ]);
  });

  it("runs only uptime when the slower jobs ran recently", () => {
    const now = at("2026-10-30T09:05:00Z");
    const lastRuns = {
      uptime: ago(now, 5),
      reviews: ago(now, 5),
      supabase: ago(now, 5),
      versions: ago(now, 5),
      expiries: ago(now, 5),
      maintenance: ago(now, 5),
    };
    expect(dueJobs(now, { lastRuns, lastDigestDate: "2026-10-30" }, options)).toEqual(["uptime"]);
  });

  it("tolerates a late previous tick", () => {
    const now = at("2026-10-30T10:00:00Z");
    // The last hourly run happened 59 minutes ago because that tick was slow.
    const lastRuns = { uptime: ago(now, 4), reviews: ago(now, 59), supabase: ago(now, 30) };
    const due = dueJobs(now, { lastRuns, lastDigestDate: "2026-10-30" }, options);
    expect(due).toContain("uptime");
    expect(due).toContain("reviews");
    expect(due).not.toContain("supabase");
  });

  it("sends the digest once per local day, after the configured hour", () => {
    const recent = (now: Date) => ({
      uptime: now, reviews: now, supabase: now, versions: now, expiries: now, maintenance: now,
    });
    // 07:55 in London: too early.
    const early = at("2026-10-30T07:55:00Z");
    expect(dueJobs(early, { lastRuns: recent(early), lastDigestDate: "2026-10-29" }, options)).not.toContain("digest");
    // 08:00: due.
    const eight = at("2026-10-30T08:00:00Z");
    expect(dueJobs(eight, { lastRuns: recent(eight), lastDigestDate: "2026-10-29" }, options)).toContain("digest");
    // Already sent today.
    expect(dueJobs(eight, { lastRuns: recent(eight), lastDigestDate: "2026-10-30" }, options)).not.toContain("digest");
    // Summer time: 07:00 UTC is 08:00 in London.
    const summer = at("2026-07-01T07:00:00Z");
    expect(dueJobs(summer, { lastRuns: recent(summer), lastDigestDate: "2026-06-30" }, options)).toContain("digest");
  });

  it("can switch the digest off", () => {
    const now = at("2026-10-30T09:00:00Z");
    expect(dueJobs(now, { lastRuns: {}, lastDigestDate: null }, { ...options, digestEnabled: false })).not.toContain("digest");
  });
});
