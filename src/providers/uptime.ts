// HTTP uptime probe. Runs from Cloudflare's network on each cron tick.

import type { FetchLike, ProbeRequest, ProbeResult, UptimeProvider } from "./types";

const MAX_KEYWORD_BYTES = 1_000_000;

export class HttpUptimeProvider implements UptimeProvider {
  constructor(
    private readonly fetcher: FetchLike,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async probe(req: ProbeRequest): Promise<ProbeResult> {
    const started = this.clock();
    let res: Response;
    try {
      res = await this.fetcher(req.url, {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": "Lighthouse uptime check", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
      return {
        ok: false,
        statusCode: null,
        latencyMs: timedOut ? req.timeoutMs : null,
        error: timedOut ? `Timed out after ${req.timeoutMs} ms` : `Request failed: ${e.message}`,
      };
    }
    const latencyMs = Math.max(0, Math.round(this.clock() - started));
    const statusOk = req.expectedStatus !== null ? res.status === req.expectedStatus : res.status >= 200 && res.status < 400;
    if (!statusOk) {
      await res.body?.cancel();
      const wanted = req.expectedStatus !== null ? `expected ${req.expectedStatus}` : "expected 2xx or 3xx";
      return { ok: false, statusCode: res.status, latencyMs, error: `HTTP ${res.status} (${wanted})` };
    }
    if (req.keyword) {
      const text = (await res.text()).slice(0, MAX_KEYWORD_BYTES);
      if (!text.includes(req.keyword)) {
        return { ok: false, statusCode: res.status, latencyMs, error: `Keyword "${req.keyword}" not found` };
      }
    } else {
      await res.body?.cancel();
    }
    return { ok: true, statusCode: res.status, latencyMs, error: null };
  }
}
