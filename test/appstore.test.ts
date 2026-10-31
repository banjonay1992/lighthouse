import { describe, expect, it } from "vitest";
import {
  AppStoreConnectClient,
  AppStoreProvider,
  createAppStoreToken,
  normaliseAscState,
} from "../src/providers/appstore";
import { decodeJwt } from "../src/lib/jwt";
import { fakeFetch, json } from "./helpers/fetch";
import { generateEcKey } from "./helpers/keys";
import type { App } from "../src/shared/types";
import reviewsPage1 from "./fixtures/asc-reviews-page1.json";
import reviewsPage2 from "./fixtures/asc-reviews-page2.json";
import versions from "./fixtures/asc-versions.json";
import certificates from "./fixtures/asc-certificates.json";
import profiles from "./fixtures/asc-profiles.json";

const app: App = { id: "kite", name: "Kite", appstoreId: "1234567890", playPackage: null, createdAt: "2026-01-01T00:00:00Z" };
const NOW = new Date("2026-10-30T12:00:00Z");

async function verifyEs256(token: string, publicKey: CryptoKey) {
  const decoded = decodeJwt(token);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    decoded.signature,
    new TextEncoder().encode(decoded.signingInput),
  );
  return { ok, ...decoded };
}

describe("App Store Connect JWT", () => {
  it("creates an ES256 token Apple will accept", async () => {
    const { pem, publicKey } = await generateEcKey();
    const token = await createAppStoreToken({ issuerId: "issuer-uuid", keyId: "KEY123ABCD", privateKey: pem }, NOW);
    const { ok, header, payload, signature } = await verifyEs256(token, publicKey);
    expect(ok).toBe(true);
    expect(signature.length).toBe(64); // raw r||s, not DER
    expect(header).toEqual({ alg: "ES256", typ: "JWT", kid: "KEY123ABCD" });
    expect(payload.iss).toBe("issuer-uuid");
    expect(payload.aud).toBe("appstoreconnect-v1");
    expect(payload.iat).toBe(NOW.getTime() / 1000);
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(20 * 60);
  });

  it("accepts keys pasted with escaped newlines", async () => {
    const { pem, publicKey } = await generateEcKey();
    const escaped = pem.replace(/\n/g, "\\n");
    const token = await createAppStoreToken({ issuerId: "i", keyId: "k", privateKey: escaped }, NOW);
    expect((await verifyEs256(token, publicKey)).ok).toBe(true);
  });

  it("rejects SEC1 keys with a helpful message", async () => {
    await expect(
      createAppStoreToken({ issuerId: "i", keyId: "k", privateKey: "-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----" }, NOW),
    ).rejects.toThrow(/PKCS#8/);
  });
});

describe("AppStoreProvider", () => {
  async function setup() {
    const { pem, publicKey } = await generateEcKey();
    const base = "https://api.appstoreconnect.apple.com";
    const { fetcher, calls } = fakeFetch({
      [`${base}/v1/apps/1234567890/customerReviews?cursor=Mg`]: () => json(reviewsPage2),
      [`${base}/v1/apps/1234567890/customerReviews`]: () => json(reviewsPage1),
      [`${base}/v1/apps/1234567890/appStoreVersions`]: () => json(versions),
      [`${base}/v1/certificates`]: () => json(certificates),
      [`${base}/v1/profiles`]: () => json(profiles),
    });
    const client = new AppStoreConnectClient({ issuerId: "issuer", keyId: "KEY", privateKey: pem }, fetcher, () => NOW);
    return { provider: new AppStoreProvider(client), calls, publicKey };
  }

  it("maps customer reviews across pages and signs each request", async () => {
    const { provider, calls, publicKey } = await setup();
    const reviews = await provider.fetchReviews(app);
    expect(reviews).toHaveLength(3);
    expect(reviews[0]).toEqual({
      storeId: "00000000-aaaa-0001",
      platform: "ios",
      rating: 5,
      title: "Exactly what I wanted",
      body: "Simple, quick and it remembers my settings. Lovely little app.",
      reviewer: "pebble_walker",
      territory: "GBR",
      appVersion: null,
      createdAt: "2026-10-29T15:15:00.000Z",
    });
    expect(reviews[2]?.title).toBeNull();
    expect(calls).toHaveLength(2);
    const auth = calls[0]!.headers.get("authorization")!;
    expect(auth.startsWith("Bearer ")).toBe(true);
    expect((await verifyEs256(auth.slice(7), publicKey)).ok).toBe(true);
    // The token is cached between requests.
    expect(calls[1]!.headers.get("authorization")).toBe(auth);
  });

  it("normalises versions and drops replaced ones", async () => {
    const { provider } = await setup();
    const out = await provider.fetchVersions(app);
    expect(out).toEqual([
      { key: "ver-200", platform: "ios", version: "2.1.0", state: "waiting for review", releaseDate: "2026-11-04" },
      { key: "ver-190", platform: "ios", version: "2.0.3", state: "live", releaseDate: null },
    ]);
  });

  it("reports certificates and active profiles as expiries", async () => {
    const { provider } = await setup();
    const items = await provider.fetchExpiries();
    expect(items).toEqual([
      {
        id: "asc-cert:CERT1",
        kind: "certificate",
        label: "Example Studio",
        expiresAt: "2027-02-14T12:00:00.000Z",
        detail: "DISTRIBUTION",
      },
      {
        id: "asc-profile:PROF1",
        kind: "profile",
        label: "Kite App Store",
        expiresAt: "2026-11-20T12:00:00.000Z",
        detail: "IOS_APP_STORE",
      },
    ]);
  });

  it("skips apps that are not on the App Store", async () => {
    const { provider, calls } = await setup();
    expect(provider.handles({ ...app, appstoreId: null })).toBe(false);
    expect(await provider.fetchReviews({ ...app, appstoreId: null })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("surfaces API errors with the status", async () => {
    const { pem } = await generateEcKey();
    const { fetcher } = fakeFetch({
      "https://api.appstoreconnect.apple.com/v1/apps": () =>
        json({ errors: [{ status: "401", title: "Unauthorized", detail: "Authentication credentials are missing or invalid." }] }, 401),
    });
    const provider = new AppStoreProvider(new AppStoreConnectClient({ issuerId: "i", keyId: "k", privateKey: pem }, fetcher));
    await expect(provider.fetchReviews(app)).rejects.toThrow(/401 Authentication credentials/);
  });

  it("labels unknown states readably", () => {
    expect(normaliseAscState("READY_FOR_SALE")).toBe("live");
    expect(normaliseAscState("SOMETHING_NEW")).toBe("something new");
    expect(normaliseAscState(undefined)).toBe("unknown");
  });
});
