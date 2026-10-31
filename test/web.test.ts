// @vitest-environment happy-dom
//
// Front-end smoke test: renders the real Preact app in happy-dom, with
// fetch wired straight into the real API handler over a demo database.
// It catches views that crash or fail to show their data.

import { beforeAll, describe, expect, it } from "vitest";
import { handleApi, resetDemoSeed } from "../src/api/routes";
import { createContext } from "../src/context";
import type { Env } from "../src/env";
import { createTestD1 } from "./helpers/d1";

// The Worker tsconfig has no DOM types, so describe the little this test uses.
interface El {
  textContent: string | null;
  getAttribute(name: string): string | null;
  click(): void;
}
declare const document: {
  body: El & { innerHTML: string };
  querySelectorAll(selector: string): Iterable<El> & { length: number };
};
declare const window: { confirm: () => boolean };
declare const location: { hash: string };

const env: Env = { DB: createTestD1(), DEMO_MODE: "true", TIMEZONE: "Europe/London" };

async function waitForText(text: string, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (document.body.textContent?.includes(text)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for "${text}". Page text: ${document.body.textContent?.slice(0, 400)}`);
}

async function go(hash: string, text: string) {
  location.hash = hash;
  await waitForText(text);
}

beforeAll(async () => {
  resetDemoSeed();
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("https://lighthouse.test/");
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://lighthouse.test");
    return handleApi(new Request(url.href, init), createContext(env, new Date()));
  }) as typeof fetch;
  window.confirm = () => true;
  document.body.innerHTML = '<div id="app"></div>';
  const entry = "../web/src/main.tsx";
  await import(/* @vite-ignore */ entry);
});

describe("front end", () => {
  it("shows the overview with things that need attention", async () => {
    await waitForText("Unread reviews");
    expect(document.body.textContent).toContain("Demo mode. All data is invented.");
    expect(document.querySelectorAll(".attention-item").length).toBeGreaterThan(0);
  });

  it("lists and filters reviews, and marks one read", async () => {
    await go("#/reviews?stars=1,2", "Widget stopped updating");
    const ratings = [...document.querySelectorAll(".stars")].map((s) => s.getAttribute("aria-label"));
    expect(ratings.every((r) => r === "1 out of 5 stars" || r === "2 out of 5 stars")).toBe(true);
    const before = document.querySelectorAll(".review.is-unread").length;
    const button = [...document.querySelectorAll(".review.is-unread .link-button")][0];
    button?.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelectorAll(".review.is-unread").length).toBe(before - 1);
  });

  it("shows endpoints, expiries, releases, Supabase and settings", async () => {
    await go("#/uptime", "Notes sync worker");
    expect(document.querySelectorAll(".spark").length).toBeGreaterThan(0);
    await go("#/uptime/sync-worker", "95th percentile");
    await go("#/expiries", "Moorland Notes development profile");
    await go("#/releases", "Winter tides blog post");
    expect(document.querySelectorAll(".calendar-cell").length).toBeGreaterThanOrEqual(28);
    await go("#/supabase", "signal-box-staging");
    await go("#/settings", "Scheduled jobs");
    expect(document.body.textContent).toContain("demo data");
  });
});
