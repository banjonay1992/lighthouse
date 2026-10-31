// Google Play Developer API adapter: reviews and release tracks.
//
// Authentication uses a Google Cloud service account that has been invited
// to the Play Console. The Worker signs an RS256 assertion with the
// account's private key and exchanges it for an OAuth access token.
// https://developers.google.com/android-publisher/authorization

import { importPrivateKey, signJwt } from "../lib/jwt";
import type { App } from "../shared/types";
import { fetchJson, ProviderError } from "./http";
import type { FetchLike, ReviewInput, StoreProvider, StoreVersion } from "./types";

export const PLAY_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/** The fields Lighthouse reads from a service account JSON key. */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError("googleplay", "GOOGLE_PLAY_SERVICE_ACCOUNT is not valid JSON");
  }
  const sa = parsed as Partial<ServiceAccount>;
  if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    throw new ProviderError("googleplay", "service account JSON needs client_email and private_key");
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

export class GoogleAuth {
  private cached: { token: string; expiresAt: number } | null = null;
  private key: Promise<CryptoKey> | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetcher: FetchLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The signed assertion sent to the token endpoint. Exposed for tests. */
  async assertion(): Promise<string> {
    const iat = Math.floor(this.now().getTime() / 1000);
    this.key ??= importPrivateKey(this.account.private_key, "RS256");
    return signJwt({
      alg: "RS256",
      privateKey: await this.key,
      payload: {
        iss: this.account.client_email,
        scope: SCOPE,
        aud: this.account.token_uri ?? DEFAULT_TOKEN_URI,
        iat,
        exp: iat + 3600,
      },
    });
  }

  async accessToken(): Promise<string> {
    const nowMs = this.now().getTime();
    if (this.cached && this.cached.expiresAt - 60_000 > nowMs) return this.cached.token;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await this.assertion(),
    });
    const res = await fetchJson<{ access_token: string; expires_in: number }>(
      this.fetcher,
      "googleplay",
      this.account.token_uri ?? DEFAULT_TOKEN_URI,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
    );
    this.cached = { token: res.access_token, expiresAt: nowMs + res.expires_in * 1000 };
    return res.access_token;
  }
}

interface PlayReviewsResponse {
  reviews?: {
    reviewId: string;
    authorName?: string;
    comments?: {
      userComment?: {
        text?: string;
        lastModified?: { seconds?: string; nanos?: number };
        starRating?: number;
        reviewerLanguage?: string;
        appVersionName?: string;
      };
    }[];
  }[];
  tokenPagination?: { nextPageToken?: string };
}

interface PlayTracksResponse {
  tracks?: {
    track: string;
    releases?: { name?: string; versionCodes?: string[]; status?: string; userFraction?: number }[];
  }[];
}

/** Play joins a separate title and body with a tab. */
export function splitPlayText(text: string): { title: string | null; body: string } {
  const tab = text.indexOf("\t");
  if (tab === -1) return { title: null, body: text.trim() };
  return { title: text.slice(0, tab).trim() || null, body: text.slice(tab + 1).trim() };
}

export function playReleaseState(track: string, status: string | undefined, userFraction?: number): string {
  switch (status) {
    case "completed":
      return track === "production" ? "live" : `${track}: live`;
    case "inProgress": {
      const pct = userFraction !== undefined ? ` ${Math.round(userFraction * 100)}%` : "";
      return track === "production" ? `rolling out${pct}` : `${track}: rolling out${pct}`;
    }
    case "halted":
      return `${track}: halted`;
    case "draft":
      return `${track}: draft`;
    default:
      return `${track}: ${status ?? "unknown"}`;
  }
}

export class GooglePlayProvider implements StoreProvider {
  readonly name = "googleplay" as const;

  constructor(
    private readonly auth: GoogleAuth,
    private readonly fetcher: FetchLike,
    private readonly options: { reviewPages?: number } = {},
  ) {}

  handles(app: App): boolean {
    return Boolean(app.playPackage);
  }

  private async headers(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.auth.accessToken()}`, accept: "application/json" };
  }

  async fetchReviews(app: App): Promise<ReviewInput[]> {
    if (!app.playPackage) return [];
    const out: ReviewInput[] = [];
    let pageToken: string | undefined;
    const maxPages = this.options.reviewPages ?? 3;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ maxResults: "100" });
      if (pageToken) params.set("token", pageToken);
      const body = await fetchJson<PlayReviewsResponse>(
        this.fetcher,
        "googleplay",
        `${PLAY_BASE}/applications/${encodeURIComponent(app.playPackage)}/reviews?${params}`,
        { headers: await this.headers() },
      );
      for (const r of body.reviews ?? []) {
        const comment = r.comments?.find((c) => c.userComment)?.userComment;
        if (!comment || !comment.starRating) continue;
        const { title, body: text } = splitPlayText(comment.text ?? "");
        const seconds = Number(comment.lastModified?.seconds ?? 0);
        out.push({
          storeId: r.reviewId,
          platform: "android",
          rating: comment.starRating,
          title,
          body: text,
          reviewer: r.authorName ?? null,
          territory: comment.reviewerLanguage ?? null,
          appVersion: comment.appVersionName ?? null,
          createdAt: new Date(seconds * 1000).toISOString(),
        });
      }
      pageToken = body.tokenPagination?.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  /**
   * Track information is only readable inside an "edit". Lighthouse opens
   * one, reads the tracks and deletes it again without committing anything.
   */
  async fetchVersions(app: App): Promise<StoreVersion[]> {
    if (!app.playPackage) return [];
    const base = `${PLAY_BASE}/applications/${encodeURIComponent(app.playPackage)}/edits`;
    const headers = await this.headers();
    const edit = await fetchJson<{ id: string }>(this.fetcher, "googleplay", base, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
    });
    try {
      const body = await fetchJson<PlayTracksResponse>(
        this.fetcher,
        "googleplay",
        `${base}/${encodeURIComponent(edit.id)}/tracks`,
        { headers },
      );
      const versions: StoreVersion[] = [];
      for (const track of body.tracks ?? []) {
        for (const release of track.releases ?? []) {
          const codes = release.versionCodes ?? [];
          versions.push({
            key: `${track.track}:${codes.join(",") || release.name || "unnamed"}`,
            platform: "android",
            version: release.name ?? codes.join(", "),
            state: playReleaseState(track.track, release.status, release.userFraction),
            releaseDate: null,
          });
        }
      }
      return versions;
    } finally {
      await this.fetcher(`${base}/${encodeURIComponent(edit.id)}`, { method: "DELETE", headers }).catch(() => undefined);
    }
  }
}
