import { describe, expect, it } from "vitest";
import { Store } from "../src/db/store";
import { createTestD1 } from "./helpers/d1";
import type { ReviewInput } from "../src/providers/types";

const NOW = "2026-10-30T09:00:00.000Z";

function review(id: string, rating: number, createdAt: string): ReviewInput {
  return {
    storeId: id,
    platform: "ios",
    rating,
    title: `Title ${id}`,
    body: `Body ${id}`,
    reviewer: "Invented Nickname",
    territory: "GBR",
    appVersion: "1.0",
    createdAt,
  };
}

async function setup() {
  const store = new Store(createTestD1());
  await store.upsertApp({ id: "kite", name: "Kite", appstoreId: "100", playPackage: null, createdAt: NOW });
  return store;
}

describe("Store", () => {
  it("inserts reviews idempotently and drops reviewer names unless asked", async () => {
    const store = await setup();
    const batch = [review("a", 5, "2026-10-29T10:00:00Z"), review("b", 1, "2026-10-28T10:00:00Z")];
    expect(await store.insertReviews("kite", batch, NOW, false)).toBe(2);
    expect(await store.insertReviews("kite", batch, NOW, false)).toBe(0);
    const { reviews } = await store.listReviews({});
    expect(reviews.map((r) => r.id)).toEqual(["ios:a", "ios:b"]);
    expect(reviews[0]?.reviewer).toBeNull();

    await store.insertReviews("kite", [review("c", 3, "2026-10-27T10:00:00Z")], NOW, true);
    const kept = await store.listReviews({ ratings: [3] });
    expect(kept.reviews[0]?.reviewer).toBe("Invented Nickname");
  });

  it("filters, paginates and tracks unread state", async () => {
    const store = await setup();
    const batch = Array.from({ length: 7 }, (_, i) => review(`r${i}`, (i % 5) + 1, `2026-10-2${i}T10:00:00Z`));
    await store.insertReviews("kite", batch, NOW, false);

    const first = await store.listReviews({ limit: 3 });
    expect(first.reviews).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await store.listReviews({ limit: 3, cursor: first.nextCursor ?? undefined });
    const third = await store.listReviews({ limit: 3, cursor: second.nextCursor ?? undefined });
    const all = [...first.reviews, ...second.reviews, ...third.reviews].map((r) => r.id);
    expect(new Set(all).size).toBe(7);
    expect(third.nextCursor).toBeNull();

    const low = await store.listReviews({ ratings: [1, 2] });
    expect(low.reviews.every((r) => r.rating <= 2)).toBe(true);

    expect(await store.countUnreadReviews()).toBe(7);
    await store.markReviewsRead(["ios:r0", "ios:r1"], NOW);
    expect(await store.countUnreadReviews()).toBe(5);
    const unread = await store.listReviews({ unreadOnly: true });
    expect(unread.reviews.map((r) => r.id)).not.toContain("ios:r0");
    await store.markReviewsUnread(["ios:r0"]);
    expect(await store.countUnreadReviews()).toBe(6);
    expect(await store.markAllReviewsRead(NOW, "kite")).toBe(6);
    expect(await store.countUnreadReviews()).toBe(0);
  });

  it("replaces expiries for a source and prefix without touching others", async () => {
    const store = await setup();
    await store.replaceExpiries(
      "appstore",
      [
        { id: "asc-cert:1", kind: "certificate", label: "Dist", expiresAt: "2027-01-01T00:00:00Z", detail: null },
        { id: "asc-cert:2", kind: "certificate", label: "Dev", expiresAt: "2026-12-01T00:00:00Z", detail: null },
      ],
      NOW,
      "asc-cert:",
    );
    await store.upsertExpiry("tls", { id: "tls:example.com", kind: "tls", label: "example.com", expiresAt: "2026-11-20T00:00:00Z", detail: null }, NOW);
    await store.replaceExpiries(
      "appstore",
      [{ id: "asc-cert:2", kind: "certificate", label: "Dev", expiresAt: "2026-12-01T00:00:00Z", detail: null }],
      NOW,
      "asc-cert:",
    );
    const ids = (await store.listExpiries()).map((e) => e.id);
    expect(ids).toEqual(["tls:example.com", "asc-cert:2"]);
  });

  it("cascades deletes from apps to reviews", async () => {
    const store = await setup();
    await store.insertReviews("kite", [review("a", 4, "2026-10-29T10:00:00Z")], NOW, false);
    await store.deleteApp("kite");
    expect((await store.listReviews({})).reviews).toHaveLength(0);
  });
});
