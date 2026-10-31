// App Store Connect API adapter: customer reviews, App Store versions,
// signing certificates and provisioning profiles.
//
// Authentication is a short-lived ES256 JWT signed with an API key (.p8)
// created under Users and Access > Integrations in App Store Connect.
// https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests

import { importPrivateKey, signJwt } from "../lib/jwt";
import type { App } from "../shared/types";
import { fetchJson, ProviderError } from "./http";
import type {
  ExpiryInput,
  FetchLike,
  ReviewInput,
  SigningAssetsProvider,
  StoreProvider,
  StoreVersion,
} from "./types";

export const ASC_BASE = "https://api.appstoreconnect.apple.com";
const TOKEN_LIFETIME_S = 20 * 60; // Apple's maximum.
const TOKEN_REUSE_S = 15 * 60;

export interface AppStoreCredentials {
  issuerId: string;
  keyId: string;
  /** Contents of the .p8 file (PKCS#8 PEM). */
  privateKey: string;
}

/** Build the bearer token App Store Connect expects. */
export async function createAppStoreToken(creds: AppStoreCredentials, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return signJwt({
    alg: "ES256",
    privateKey: creds.privateKey,
    header: { kid: creds.keyId },
    payload: { iss: creds.issuerId, iat, exp: iat + TOKEN_LIFETIME_S, aud: "appstoreconnect-v1" },
  });
}

interface AscResource<A> {
  id: string;
  type: string;
  attributes: A;
}

interface AscList<A> {
  data: AscResource<A>[];
  links?: { next?: string };
}

interface CustomerReviewAttributes {
  rating: number;
  title?: string | null;
  body?: string | null;
  reviewerNickname?: string | null;
  createdDate: string;
  territory?: string | null;
}

interface VersionAttributes {
  versionString: string;
  appStoreState?: string;
  appVersionState?: string;
  platform?: string;
  createdDate?: string;
  earliestReleaseDate?: string | null;
}

interface CertificateAttributes {
  name?: string;
  displayName?: string;
  certificateType?: string;
  expirationDate: string;
  platform?: string | null;
}

interface ProfileAttributes {
  name: string;
  profileType?: string;
  profileState?: string;
  expirationDate: string;
}

const STATE_LABELS: Record<string, string> = {
  READY_FOR_SALE: "live",
  READY_FOR_DISTRIBUTION: "live",
  PENDING_DEVELOPER_RELEASE: "pending release",
  PENDING_APPLE_RELEASE: "pending release",
  PROCESSING_FOR_APP_STORE: "processing",
  PROCESSING_FOR_DISTRIBUTION: "processing",
  WAITING_FOR_REVIEW: "waiting for review",
  IN_REVIEW: "in review",
  PREPARE_FOR_SUBMISSION: "preparing",
  REJECTED: "rejected",
  METADATA_REJECTED: "rejected",
  DEVELOPER_REJECTED: "withdrawn",
  INVALID_BINARY: "invalid binary",
  REPLACED_WITH_NEW_VERSION: "replaced",
  DEVELOPER_REMOVED_FROM_SALE: "removed",
  REMOVED_FROM_SALE: "removed",
};

export function normaliseAscState(raw: string | undefined): string {
  if (!raw) return "unknown";
  return STATE_LABELS[raw] ?? raw.toLowerCase().replace(/_/g, " ");
}

export class AppStoreConnectClient {
  private token: { value: string; issuedAt: number } | null = null;
  private key: Promise<CryptoKey> | null = null;

  constructor(
    private readonly creds: AppStoreCredentials,
    private readonly fetcher: FetchLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async bearer(): Promise<string> {
    const nowS = Math.floor(this.now().getTime() / 1000);
    if (this.token && nowS - this.token.issuedAt < TOKEN_REUSE_S) return this.token.value;
    this.key ??= importPrivateKey(this.creds.privateKey, "ES256");
    const value = await signJwt({
      alg: "ES256",
      privateKey: await this.key,
      header: { kid: this.creds.keyId },
      payload: { iss: this.creds.issuerId, iat: nowS, exp: nowS + TOKEN_LIFETIME_S, aud: "appstoreconnect-v1" },
    });
    this.token = { value, issuedAt: nowS };
    return value;
  }

  /** GET a list endpoint, following `links.next` up to `maxPages`. */
  async list<A>(path: string, maxPages = 1): Promise<AscResource<A>[]> {
    const out: AscResource<A>[] = [];
    let url: string | undefined = path.startsWith("http") ? path : `${ASC_BASE}${path}`;
    for (let page = 0; url && page < maxPages; page++) {
      if (!url.startsWith(ASC_BASE)) throw new ProviderError("appstore", "refusing to follow a link off the API host");
      const body: AscList<A> = await fetchJson<AscList<A>>(this.fetcher, "appstore", url, {
        headers: { authorization: `Bearer ${await this.bearer()}`, accept: "application/json" },
      });
      out.push(...body.data);
      url = body.links?.next;
    }
    return out;
  }
}

export class AppStoreProvider implements StoreProvider, SigningAssetsProvider {
  readonly name = "appstore" as const;

  constructor(
    private readonly client: AppStoreConnectClient,
    private readonly options: { reviewPages?: number } = {},
  ) {}

  handles(app: App): boolean {
    return Boolean(app.appstoreId);
  }

  async fetchReviews(app: App): Promise<ReviewInput[]> {
    if (!app.appstoreId) return [];
    const path =
      `/v1/apps/${encodeURIComponent(app.appstoreId)}/customerReviews?sort=-createdDate&limit=100` +
      "&fields[customerReviews]=rating,title,body,reviewerNickname,createdDate,territory";
    const data = await this.client.list<CustomerReviewAttributes>(path, this.options.reviewPages ?? 2);
    return data.map((r) => ({
      storeId: r.id,
      platform: "ios",
      rating: r.attributes.rating,
      title: r.attributes.title ?? null,
      body: r.attributes.body ?? "",
      reviewer: r.attributes.reviewerNickname ?? null,
      territory: r.attributes.territory ?? null,
      appVersion: null,
      createdAt: new Date(r.attributes.createdDate).toISOString(),
    }));
  }

  async fetchVersions(app: App): Promise<StoreVersion[]> {
    if (!app.appstoreId) return [];
    const path =
      `/v1/apps/${encodeURIComponent(app.appstoreId)}/appStoreVersions?limit=10` +
      "&fields[appStoreVersions]=versionString,appStoreState,appVersionState,platform,createdDate,earliestReleaseDate";
    const data = await this.client.list<VersionAttributes>(path);
    return data
      .map((v) => ({
        key: v.id,
        platform: v.attributes.platform === "IOS" || !v.attributes.platform ? ("ios" as const) : ("other" as const),
        version: v.attributes.versionString,
        state: normaliseAscState(v.attributes.appStoreState ?? v.attributes.appVersionState),
        releaseDate: v.attributes.earliestReleaseDate ? v.attributes.earliestReleaseDate.slice(0, 10) : null,
      }))
      .filter((v) => v.state !== "replaced" && v.state !== "removed")
      .slice(0, 5);
  }

  async fetchExpiries(): Promise<ExpiryInput[]> {
    const [certs, profiles] = await Promise.all([
      this.client.list<CertificateAttributes>(
        "/v1/certificates?limit=200&fields[certificates]=name,displayName,certificateType,expirationDate,platform",
      ),
      this.client.list<ProfileAttributes>(
        "/v1/profiles?limit=200&filter[profileState]=ACTIVE&fields[profiles]=name,profileType,profileState,expirationDate",
      ),
    ]);
    const items: ExpiryInput[] = [];
    for (const c of certs) {
      items.push({
        id: `asc-cert:${c.id}`,
        kind: "certificate",
        label: c.attributes.displayName ?? c.attributes.name ?? "Signing certificate",
        expiresAt: new Date(c.attributes.expirationDate).toISOString(),
        detail: c.attributes.certificateType ?? null,
      });
    }
    for (const p of profiles) {
      items.push({
        id: `asc-profile:${p.id}`,
        kind: "profile",
        label: p.attributes.name,
        expiresAt: new Date(p.attributes.expirationDate).toISOString(),
        detail: p.attributes.profileType ?? null,
      });
    }
    return items;
  }
}
