import { describe, expect, it } from "vitest";
import {
  GoogleAuth,
  GooglePlayProvider,
  parseServiceAccount,
  playReleaseState,
  splitPlayText,
} from "../src/providers/googleplay";
import { decodeJwt, verifyRs256 } from "../src/lib/jwt";
import { fakeFetch, json } from "./helpers/fetch";
import { generateRsaKey } from "./helpers/keys";
import type { App } from "../src/shared/types";
import reviews from "./fixtures/play-reviews.json";
import reviewsPage2 from "./fixtures/play-reviews-page2.json";
import tracks from "./fixtures/play-tracks.json";

const app: App = { id: "kite", name: "Kite", appstoreId: null, playPackage: "com.example.kite", createdAt: "2026-01-01T00:00:00Z" };
const NOW = new Date("2026-10-30T12:00:00Z");
const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.kite";

async function setup() {
  const key = await generateRsaKey();
  let tokenRequests = 0;
  const { fetcher, calls } = fakeFetch({
    "POST https://oauth2.googleapis.com/token": async (req) => {
      tokenRequests++;
      const params = new URLSearchParams(req.body ?? "");
      expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const decoded = decodeJwt(params.get("assertion")!);
      expect(await verifyRs256(decoded, key.jwk)).toBe(true);
      return json({ access_token: "ya29.fake-token", expires_in: 3600, token_type: "Bearer" });
    },
    [`${BASE}/reviews?maxResults=100&token=page-2`]: () => json(reviewsPage2),
    [`${BASE}/reviews`]: () => json(reviews),
    [`POST ${BASE}/edits`]: () => json({ id: "edit-42" }),
    [`${BASE}/edits/edit-42/tracks`]: () => json(tracks),
    [`DELETE ${BASE}/edits/edit-42`]: () => new Response(null, { status: 204 }),
  });
  const account = { client_email: "lighthouse@invented-project.iam.gserviceaccount.com", private_key: key.pem };
  const auth = new GoogleAuth(account, fetcher, () => NOW);
  return { provider: new GooglePlayProvider(auth, fetcher), auth, calls, key, tokenRequests: () => tokenRequests };
}

describe("Google service account auth", () => {
  it("signs an RS256 assertion with the right claims", async () => {
    const { auth, key } = await setup();
    const decoded = decodeJwt(await auth.assertion());
    expect(await verifyRs256(decoded, key.jwk)).toBe(true);
    expect(decoded.header.alg).toBe("RS256");
    expect(decoded.payload).toMatchObject({
      iss: "lighthouse@invented-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 3600,
    });
  });

  it("parses service account JSON and rejects junk", () => {
    expect(parseServiceAccount('{"client_email":"a@b","private_key":"k","type":"service_account"}')).toEqual({
      client_email: "a@b",
      private_key: "k",
      token_uri: undefined,
    });
    expect(() => parseServiceAccount("not json")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount("{}")).toThrow(/client_email/);
  });
});

describe("GooglePlayProvider", () => {
  it("reads reviews across pages, splitting titles and reusing the token", async () => {
    const { provider, calls, tokenRequests } = await setup();
    const out = await provider.fetchReviews(app);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      storeId: "gp:AOqpTOExample0001",
      platform: "android",
      rating: 5,
      title: "Works well",
      body: "Nice and light on battery, does what it says.",
      reviewer: "Invented Person",
      territory: "en_GB",
      appVersion: "3.2.0",
      createdAt: new Date(1793260800 * 1000).toISOString(),
    });
    expect(out[1]?.title).toBeNull();
    expect(out[2]?.appVersion).toBeNull();
    expect(tokenRequests()).toBe(1);
    const apiCalls = calls.filter((c) => c.url.startsWith(BASE));
    expect(apiCalls.every((c) => c.headers.get("authorization") === "Bearer ya29.fake-token")).toBe(true);
  });

  it("reads tracks inside a throwaway edit and always deletes it", async () => {
    const { provider, calls } = await setup();
    const out = await provider.fetchVersions(app);
    expect(out).toEqual([
      { key: "production:320", platform: "android", version: "3.2.0", state: "rolling out 20%", releaseDate: null },
      { key: "production:319", platform: "android", version: "3.1.9", state: "live", releaseDate: null },
      { key: "internal:330", platform: "android", version: "3.3.0-beta1", state: "internal: live", releaseDate: null },
    ]);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/edits/edit-42"))).toBe(true);
  });

  it("formats release states", () => {
    expect(playReleaseState("beta", "halted")).toBe("beta: halted");
    expect(playReleaseState("production", "draft")).toBe("production: draft");
    expect(splitPlayText("only body")).toEqual({ title: null, body: "only body" });
  });
});
