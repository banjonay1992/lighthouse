// Types shared by the Worker and the front end. These describe what the API
// returns, so keep them free of Worker-only imports.

export type Platform = "ios" | "android";
export type EndpointStatus = "up" | "down" | "unknown";
export type Severity = "expired" | "urgent" | "soon" | "later";
export type RepeatRule = "none" | "monthly" | "yearly";
export type ReleasePlatform = "ios" | "android" | "web" | "other";
export type ReleaseSource = "manual" | "appstore" | "googleplay";
export type ExpiryKind =
  | "certificate"
  | "profile"
  | "tls"
  | "domain"
  | "agreement"
  | "membership"
  | "other";

export interface App {
  id: string;
  name: string;
  appstoreId: string | null;
  playPackage: string | null;
  createdAt: string;
}

export interface Review {
  id: string;
  appId: string;
  platform: Platform;
  rating: number;
  title: string | null;
  body: string;
  reviewer: string | null;
  territory: string | null;
  appVersion: string | null;
  createdAt: string;
  fetchedAt: string;
  readAt: string | null;
}

export interface ReviewPage {
  reviews: Review[];
  unreadTotal: number;
  nextCursor: string | null;
}

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  expectedStatus: number | null;
  keyword: string | null;
  timeoutMs: number;
  checkTls: boolean;
  failureThreshold: number;
  recoveryThreshold: number;
  status: EndpointStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  createdAt: string;
}

export interface CheckPoint {
  at: string;
  ok: boolean;
  latencyMs: number | null;
}

export interface EndpointSummary extends Endpoint {
  uptime24h: number | null;
  uptime7d: number | null;
  recent: CheckPoint[];
  openIncident: Incident | null;
}

export interface Incident {
  id: number;
  endpointId: string;
  endpointName?: string;
  startedAt: string;
  resolvedAt: string | null;
  cause: string;
  failureCount: number;
}

export interface ExpiryItem {
  id: string;
  source: string;
  kind: ExpiryKind;
  label: string;
  expiresAt: string;
  detail: string | null;
  daysLeft: number;
  severity: Severity;
  manual: boolean;
  repeat?: RepeatRule;
}

export interface Reminder {
  id: string;
  title: string;
  kind: ExpiryKind;
  dueOn: string;
  repeat: RepeatRule;
  notes: string | null;
  createdAt: string;
}

export interface Release {
  id: string;
  appId: string | null;
  platform: ReleasePlatform;
  version: string;
  state: string;
  releaseDate: string | null;
  source: ReleaseSource;
  notes: string | null;
  updatedAt: string;
}

export interface SupabaseService {
  name: string;
  healthy: boolean;
  status?: string;
}

export interface SupabaseProject {
  ref: string;
  name: string;
  region: string | null;
  status: string;
  healthy: boolean | null;
  services: SupabaseService[];
  dbSizeBytes: number | null;
  checkedAt: string;
}

export interface JobRun {
  job: string;
  lastRunAt: string;
  lastOk: boolean;
  lastError: string | null;
}

export interface Overview {
  generatedAt: string;
  demo: boolean;
  attention: AttentionItem[];
  reviews: { unread: number; lowRatedUnread: number; last7d: number; average30d: number | null };
  uptime: { total: number; up: number; down: number; unknown: number };
  expiries: { within30d: number; next: ExpiryItem | null };
  releases: { upcoming: Release[] };
  supabase: { total: number; unhealthy: number };
  jobs: JobRun[];
}

export interface AttentionItem {
  level: "critical" | "warning";
  area: "uptime" | "reviews" | "expiries" | "supabase" | "jobs";
  message: string;
  href: string;
}

export interface SessionInfo {
  authMode: "access" | "passphrase" | "open" | "unconfigured";
  authenticated: boolean;
  demo: boolean;
}

export interface DigestPreview {
  subject: string;
  text: string;
  html: string;
  quiet: boolean;
}

export interface ApiError {
  error: string;
}
