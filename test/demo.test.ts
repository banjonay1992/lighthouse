import { describe, expect, it } from "vitest";
import { buildProviders, providerStatus } from "../src/providers/registry";
import { demoProbe, demoReviews } from "../src/providers/demo";
import { readConfig } from "../src/env";

const NOW = new Date("2026-10-30T12:00:00Z");

describe("demo providers", () => {
  it("are used for everything in demo mode", () => {
    const env = { DB: {} as D1Database, DEMO_MODE: "true" };
    const providers = buildProviders(env, readConfig(env), undefined, () => NOW);
    expect(providers.stores.map((s) => s.name)).toEqual(["appstore", "googleplay"]);
    expect(providers.signing && providers.tls && providers.supabase).toBeTruthy();
  });

  it("only build live providers whose credentials are present", () => {
    const env = { DB: {} as D1Database, SUPABASE_ACCESS_TOKEN: "sbp_x" };
    const config = readConfig(env);
    const providers = buildProviders(env, config);
    expect(providers.stores).toHaveLength(0);
    expect(providers.signing).toBeNull();
    expect(providers.supabase).not.toBeNull();
    expect(providerStatus(env, config)).toMatchObject({ appstore: false, googleplay: false, supabase: true, tls: true });
  });

  it("produce stable review ids so repeated fetches do not duplicate", () => {
    const a = demoReviews("tidewatch", "ios", NOW).map((r) => r.storeId);
    const b = demoReviews("tidewatch", "ios", new Date(NOW.getTime() + 60_000)).map((r) => r.storeId);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
  });

  it("never date a review in the future", () => {
    for (let h = 0; h < 48; h++) {
      const now = new Date(NOW.getTime() + h * 1800_000);
      for (const app of ["tidewatch", "moorland-notes", "signal-box"]) {
        for (const platform of ["ios", "android"] as const) {
          for (const r of demoReviews(app, platform, now)) expect(Date.parse(r.createdAt)).toBeLessThanOrEqual(now.getTime());
        }
      }
    }
  });

  it("include an occasional outage on the sync host", () => {
    const results = Array.from({ length: 288 }, (_, i) => demoProbe("https://sync.example.net/ping", new Date(NOW.getTime() + i * 300_000)));
    const failures = results.filter((r) => !r.ok).length;
    expect(failures).toBeGreaterThan(0);
    expect(failures).toBeLessThan(40);
  });
});
