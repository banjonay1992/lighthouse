import { describe, expect, it } from "vitest";
import { HttpUptimeProvider } from "../src/providers/uptime";
import { fakeFetch } from "./helpers/fetch";

function clock(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

const req = { url: "https://api.example.com/health", timeoutMs: 5000, expectedStatus: null, keyword: null };

describe("HttpUptimeProvider", () => {
  it("measures latency and accepts 2xx by default", async () => {
    const { fetcher, calls } = fakeFetch({ "https://api.example.com": () => new Response("ok") });
    const result = await new HttpUptimeProvider(fetcher, clock(1000, 1123)).probe(req);
    expect(result).toEqual({ ok: true, statusCode: 200, latencyMs: 123, error: null });
    expect(calls[0]!.headers.get("user-agent")).toBe("Lighthouse uptime check");
  });

  it("fails on unexpected status codes", async () => {
    const { fetcher } = fakeFetch({ "https://api.example.com": () => new Response("nope", { status: 502 }) });
    const result = await new HttpUptimeProvider(fetcher, clock(0, 40)).probe(req);
    expect(result).toMatchObject({ ok: false, statusCode: 502, error: "HTTP 502 (expected 2xx or 3xx)" });
  });

  it("honours an explicit expected status", async () => {
    const { fetcher } = fakeFetch({ "https://api.example.com": () => new Response(null, { status: 204 }) });
    expect((await new HttpUptimeProvider(fetcher).probe({ ...req, expectedStatus: 204 })).ok).toBe(true);
    expect((await new HttpUptimeProvider(fetcher).probe({ ...req, expectedStatus: 200 })).ok).toBe(false);
  });

  it("checks for a keyword in the body", async () => {
    const { fetcher } = fakeFetch({ "https://api.example.com": () => new Response('{"status":"degraded"}') });
    const provider = new HttpUptimeProvider(fetcher);
    expect((await provider.probe({ ...req, keyword: '"status":"ok"' })).error).toMatch(/not found/);
    expect((await provider.probe({ ...req, keyword: "degraded" })).ok).toBe(true);
  });

  it("reports timeouts and network errors", async () => {
    const timeout = async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };
    const result = await new HttpUptimeProvider(timeout).probe(req);
    expect(result).toEqual({ ok: false, statusCode: null, latencyMs: 5000, error: "Timed out after 5000 ms" });

    const refused = async () => {
      throw new TypeError("connection refused");
    };
    expect((await new HttpUptimeProvider(refused).probe(req)).error).toBe("Request failed: connection refused");
  });
});
