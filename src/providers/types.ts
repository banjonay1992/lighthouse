// Interfaces every provider adapter implements. Each has a live
// implementation that talks to the real API and a fake used in demo mode and
// in tests. Nothing outside src/providers should know which one it has.

import type { App, ExpiryKind, Platform, ReleasePlatform, SupabaseService } from "../shared/types";

/** The fetch signature adapters use, injectable so tests never hit the network. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ReviewInput {
  /** The store's own id for the review. */
  storeId: string;
  platform: Platform;
  rating: number;
  title: string | null;
  body: string;
  reviewer: string | null;
  territory: string | null;
  appVersion: string | null;
  createdAt: string;
}

export interface StoreVersion {
  platform: ReleasePlatform;
  version: string;
  /** The store's state, normalised to a short lower-case label. */
  state: string;
  releaseDate: string | null;
  /** Stable key so repeated fetches update the same row. */
  key: string;
}

export interface ExpiryInput {
  id: string;
  kind: ExpiryKind;
  label: string;
  expiresAt: string;
  detail: string | null;
}

/** App Store Connect or Google Play. */
export interface StoreProvider {
  readonly name: "appstore" | "googleplay";
  /** Whether this app is listed on this store at all. */
  handles(app: App): boolean;
  fetchReviews(app: App): Promise<ReviewInput[]>;
  fetchVersions(app: App): Promise<StoreVersion[]>;
}

/** Account-level expiries from App Store Connect (certificates, profiles). */
export interface SigningAssetsProvider {
  fetchExpiries(): Promise<ExpiryInput[]>;
}

export interface ProbeRequest {
  url: string;
  timeoutMs: number;
  expectedStatus: number | null;
  keyword: string | null;
}

export interface ProbeResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface UptimeProvider {
  probe(request: ProbeRequest): Promise<ProbeResult>;
}

export interface CertificateInfo {
  hostname: string;
  notAfter: string;
  notBefore: string | null;
  issuer: string | null;
}

export interface TlsProvider {
  /** Returns null when no certificate could be found for the host. */
  lookup(hostname: string): Promise<CertificateInfo | null>;
}

export interface SupabaseProjectInput {
  ref: string;
  name: string;
  region: string | null;
  status: string;
  services: SupabaseService[];
  dbSizeBytes: number | null;
}

export interface SupabaseProvider {
  fetchProjects(): Promise<SupabaseProjectInput[]>;
}

/** The full set of providers the scheduler works with. Any may be absent. */
export interface Providers {
  stores: StoreProvider[];
  signing: SigningAssetsProvider | null;
  uptime: UptimeProvider;
  tls: TlsProvider | null;
  supabase: SupabaseProvider | null;
}
