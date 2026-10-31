import { describe, expect, it } from "vitest";
import { buildDigest, escapeHtml, type DigestInput } from "../src/digest/build";
import { buildSender, LogSender, ResendSender, WebhookSender } from "../src/digest/send";
import { readConfig } from "../src/env";
import { fakeFetch, json } from "./helpers/fetch";
import type { Review } from "../src/shared/types";

const NOW = new Date("2026-10-30T08:00:00Z");

function review(id: string, rating: number, body: string, title: string | null = null): Review {
  return {
    id,
    appId: "tidewatch",
    platform: "ios",
    rating,
    title,
    body,
    reviewer: null,
    territory: "GBR",
    appVersion: null,
    createdAt: "2026-10-29T10:00:00Z",
    fetchedAt: "2026-10-29T11:00:00Z",
    readAt: null,
  };
}

function input(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    now: NOW,
    since: new Date(NOW.getTime() - 86_400_000),
    timeZone: "Europe/London",
    dashboardUrl: null,
    apps: [{ id: "tidewatch", name: "Tidewatch", appstoreId: "1", playPackage: null, createdAt: "" }],
    newReviews: [],
    incidents: [],
    expiries: [],
    upcomingReleases: [],
    events: [],
    supabase: [],
    ...overrides,
  };
}

describe("digest building", () => {
  it("says all quiet when nothing happened", () => {
    const d = buildDigest(input());
    expect(d.quiet).toBe(true);
    expect(d.subject).toBe("Lighthouse: all quiet");
    expect(d.text).toContain("Lighthouse digest for Friday 30 October 2026");
    expect(d.text).toContain("Nothing needs your attention");
  });

  it("summarises reviews with low ratings first", () => {
    const d = buildDigest(
      input({
        newReviews: [review("a", 5, "Lovely"), review("b", 1, "Crashes on launch", "Broken"), review("c", 4, "Good")],
      }),
    );
    expect(d.quiet).toBe(false);
    expect(d.subject).toBe("Lighthouse: 3 new reviews");
    const lines = d.text.split("\n");
    const first = lines.findIndex((l) => l.includes("1★"));
    const five = lines.findIndex((l) => l.includes("5★"));
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(five);
    expect(d.text).toContain("3 new reviews, averaging 3.3 stars. 1 rated 1 or 2 stars.");
    expect(d.text).toContain('Tidewatch (iOS), 1★: "Broken: Crashes on launch"');
  });

  it("reports open and resolved incidents, expiries, releases and changes", () => {
    const d = buildDigest(
      input({
        dashboardUrl: "https://lighthouse.example.com",
        incidents: [
          { id: 1, endpointId: "api", endpointName: "API", startedAt: "2026-10-30T07:30:00Z", resolvedAt: null, cause: "HTTP 503", failureCount: 6 },
          { id: 2, endpointId: "www", endpointName: "Website", startedAt: "2026-10-29T13:00:00Z", resolvedAt: "2026-10-29T13:15:00Z", cause: "Timed out", failureCount: 3 },
        ],
        expiries: [
          { id: "x", source: "appstore", kind: "profile", label: "Dev profile", expiresAt: "", detail: null, daysLeft: 3, severity: "urgent", manual: false },
          { id: "y", source: "tls", kind: "tls", label: "TLS far away", expiresAt: "", detail: null, daysLeft: 80, severity: "later", manual: false },
        ],
        upcomingReleases: [
          { id: "r", appId: "tidewatch", platform: "ios", version: "3.4.0", state: "waiting for review", releaseDate: "2026-11-04", source: "appstore", notes: null, updatedAt: "" },
        ],
        events: [{ id: 1, at: "", kind: "supabase_status", subject: "Supabase project side", detail: "ACTIVE_HEALTHY to INACTIVE" }],
      }),
    );
    expect(d.subject).toBe("Lighthouse: 1 endpoint down, 1 expiry due");
    expect(d.text).toContain("API is down, for 30 min so far (HTTP 503).");
    expect(d.text).toContain("Website was down for 15 min from 13:00 (Timed out). Resolved.");
    expect(d.text).toContain("Dev profile: 3 days left.");
    expect(d.text).not.toContain("TLS far away");
    expect(d.text).toContain("Tidewatch 3.4.0 (iOS), Wed 4 Nov: waiting for review.");
    expect(d.text).toContain("Supabase project side: ACTIVE_HEALTHY to INACTIVE.");
    expect(d.text).toContain("Open the dashboard: https://lighthouse.example.com");
  });

  it("escapes review text in the HTML version", () => {
    const d = buildDigest(input({ newReviews: [review("x", 2, '<script>alert("hi")</script> & more')] }));
    expect(d.html).not.toContain("<script>");
    expect(d.html).toContain("&lt;script&gt;");
    expect(escapeHtml(`'"`)).toBe("&#39;&quot;");
  });

  it("never uses em dashes", () => {
    const d = buildDigest(input({ newReviews: [review("a", 3, "Fine")] }));
    expect(d.text).not.toContain("—");
    expect(d.html).not.toContain("—");
  });
});

describe("digest senders", () => {
  const digest = { subject: "Lighthouse: all quiet", text: "Nothing to report\n", html: "<p>x</p>", quiet: true };

  it("posts JSON, Slack and Discord shaped webhooks", async () => {
    const { fetcher, calls } = fakeFetch({ "POST https://hooks.example.com/": () => new Response("ok") });
    await new WebhookSender("https://hooks.example.com/abc", "json", fetcher).send(digest);
    await new WebhookSender("https://hooks.example.com/abc", "slack", fetcher).send(digest);
    await new WebhookSender("https://hooks.example.com/abc", "discord", fetcher).send(digest);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ subject: digest.subject, quiet: true });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ text: "*Lighthouse: all quiet*\nNothing to report\n" });
    expect(JSON.parse(calls[2]!.body!).content).toContain("**Lighthouse: all quiet**");
  });

  it("raises when a webhook fails", async () => {
    const { fetcher } = fakeFetch({ "POST https://hooks.example.com/": () => new Response("no", { status: 500 }) });
    await expect(new WebhookSender("https://hooks.example.com/x", "json", fetcher).send(digest)).rejects.toThrow(/500/);
  });

  it("sends email through Resend", async () => {
    const { fetcher, calls } = fakeFetch({ "POST https://api.resend.com/emails": () => json({ id: "email_1" }) });
    await new ResendSender("re_fake", "Lighthouse <digest@example.com>", ["me@example.com"], fetcher).send(digest);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer re_fake");
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ to: ["me@example.com"], subject: digest.subject });
  });

  it("logs when asked to", async () => {
    const lines: string[] = [];
    await new LogSender((m) => lines.push(m)).send(digest);
    expect(lines[0]).toContain("all quiet");
  });

  it("explains missing settings instead of failing silently", () => {
    const env = { DB: {} as D1Database, DIGEST_PROVIDER: "resend", RESEND_API_KEY: "re_x" };
    expect(buildSender(env, readConfig(env), fetch)).toEqual({ error: expect.stringContaining("DIGEST_EMAIL_TO") });
    const none = { DB: {} as D1Database };
    expect(buildSender(none, readConfig(none), fetch)).toBeNull();
  });
});
