import { describe, expect, it } from "vitest";
import { SupabaseManagementProvider } from "../src/providers/supabase";
import { fakeFetch, json } from "./helpers/fetch";
import projects from "./fixtures/supabase-projects.json";
import health from "./fixtures/supabase-health.json";

const API = "https://api.supabase.com/v1/projects";

describe("SupabaseManagementProvider", () => {
  it("reads project status and per-service health for active projects", async () => {
    const { fetcher, calls } = fakeFetch({
      [API]: () => json(projects),
      [`${API}/abcdefghijklmnopqrst/health`]: () => json(health),
    });
    const out = await new SupabaseManagementProvider("sbp_fake", fetcher).fetchProjects();
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ ref: "abcdefghijklmnopqrst", name: "kite-production", status: "ACTIVE_HEALTHY", dbSizeBytes: null });
    expect(out[0]!.services.find((s) => s.name === "rest")).toEqual({ name: "rest", healthy: false, status: "UNHEALTHY" });
    // Paused projects are reported without a health call.
    expect(out[1]).toMatchObject({ status: "INACTIVE", services: [] });
    expect(calls.some((c) => c.url.includes("zyxwvutsrqponmlkjihg"))).toBe(false);
    expect(calls.every((c) => c.headers.get("authorization") === "Bearer sbp_fake")).toBe(true);
    const healthUrl = new URL(calls[1]!.url);
    expect(healthUrl.searchParams.getAll("services")).toEqual(["db", "auth", "rest", "storage"]);
  });

  it("optionally reads database size and tolerates failures", async () => {
    const { fetcher } = fakeFetch({
      [API]: () => json(projects.slice(0, 1)),
      [`${API}/abcdefghijklmnopqrst/health`]: () => json({ message: "boom" }, 500),
      [`POST ${API}/abcdefghijklmnopqrst/database/query`]: () => json([{ bytes: "123456789" }]),
    });
    const out = await new SupabaseManagementProvider("t", fetcher, { includeDatabaseSize: true }).fetchProjects();
    expect(out[0]).toMatchObject({ services: [], dbSizeBytes: 123456789 });
  });

  it("propagates errors listing projects", async () => {
    const { fetcher } = fakeFetch({ [API]: () => json({ message: "Unauthorized" }, 401) });
    await expect(new SupabaseManagementProvider("bad", fetcher).fetchProjects()).rejects.toThrow(/401 Unauthorized/);
  });
});
