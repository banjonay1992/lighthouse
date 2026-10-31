// Fake providers for DEMO_MODE and tests. Everything here is invented: the
// apps, the reviews, the reviewer nicknames, the hostnames (all under the
// reserved example.* domains) and the Supabase projects.
//
// The fakes are deterministic for a given clock, but move with time, so a
// demo left running sees new reviews arrive and an occasional outage.

import { DAY, HOUR } from "../lib/time";
import type { App } from "../shared/types";
import type {
  CertificateInfo,
  ExpiryInput,
  ProbeRequest,
  ProbeResult,
  ReviewInput,
  SigningAssetsProvider,
  StoreProvider,
  StoreVersion,
  SupabaseProjectInput,
  SupabaseProvider,
  TlsProvider,
  UptimeProvider,
} from "./types";

/** Small, stable string hash (FNV-1a) used to vary fake data. */
export function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface DemoReview {
  app: string;
  platform: "ios" | "android";
  rating: number;
  title: string | null;
  body: string;
  nickname: string;
  territory: string;
  hoursAgo: number;
  version: string | null;
}

const REVIEWS: DemoReview[] = [
  { app: "tidewatch", platform: "ios", rating: 5, title: "Perfect for early swims", body: "I check it every morning before heading down to the cove. Clear, quick and no clutter.", nickname: "cove_dipper", territory: "GBR", hoursAgo: 3, version: null },
  { app: "tidewatch", platform: "ios", rating: 2, title: "Widget stopped updating", body: "Since the last update the home screen widget shows yesterday's tides until I open the app.", nickname: "slipway_sam", territory: "GBR", hoursAgo: 9, version: null },
  { app: "tidewatch", platform: "android", rating: 4, title: "Very handy", body: "Does exactly what it says. Would love a tide height graph for the whole week.", nickname: "Invented Angler", territory: "en_GB", hoursAgo: 20, version: "3.3.2" },
  { app: "tidewatch", platform: "ios", rating: 5, title: null, body: "Lovely design and it works offline on the coast path.", nickname: "gull_watcher", territory: "IRL", hoursAgo: 30, version: null },
  { app: "tidewatch", platform: "android", rating: 1, title: "Wrong harbour", body: "My local harbour is listed about two miles from where it really is.", nickname: "Made Up Mariner", territory: "en_GB", hoursAgo: 44, version: "3.3.2" },
  { app: "tidewatch", platform: "ios", rating: 3, title: "Good but", body: "Good app but the notifications arrive a bit late for spring tides.", nickname: "rockpool_rita", territory: "AUS", hoursAgo: 70, version: null },
  { app: "tidewatch", platform: "ios", rating: 5, title: "Worth it", body: "Paid for the pro version within a week. The surf window feature is brilliant.", nickname: "longboard_lou", territory: "USA", hoursAgo: 96, version: null },
  { app: "tidewatch", platform: "android", rating: 4, title: null, body: "Nice and light on battery.", nickname: "Pretend Paddler", territory: "de_DE", hoursAgo: 130, version: "3.3.1" },
  { app: "moorland-notes", platform: "ios", rating: 5, title: "Calm and simple", body: "Finally a notes app that does not try to be everything. Syncs quietly in the background.", nickname: "heather_and_granite", territory: "GBR", hoursAgo: 5, version: null },
  { app: "moorland-notes", platform: "ios", rating: 4, title: "Almost there", body: "Really like it. Please add a way to export everything as plain text files.", nickname: "tor_top", territory: "GBR", hoursAgo: 26, version: null },
  { app: "moorland-notes", platform: "ios", rating: 2, title: "Lost a note", body: "A note I wrote on the train disappeared after syncing. Has happened twice now.", nickname: "branch_line_bea", territory: "GBR", hoursAgo: 50, version: null },
  { app: "moorland-notes", platform: "ios", rating: 5, title: null, body: "The search is fast and the fonts are easy on the eyes.", nickname: "quiet_quill", territory: "CAN", hoursAgo: 150, version: null },
  { app: "signal-box", platform: "android", rating: 5, title: "Great for train spotters", body: "Live departures plus the history of each station. Brilliant hobby app.", nickname: "Fictional Fireman", territory: "en_GB", hoursAgo: 7, version: "2.0.1" },
  { app: "signal-box", platform: "android", rating: 3, title: null, body: "Useful, though the map is slow on my older phone.", nickname: "Sample Shunter", territory: "en_GB", hoursAgo: 60, version: "2.0.1" },
  { app: "signal-box", platform: "android", rating: 1, title: "Login loop", body: "Keeps asking me to sign in again every time I open it.", nickname: "Example Engineer", territory: "fr_FR", hoursAgo: 85, version: "2.0.0" },
];

/** Rotating templates so a long-running demo keeps receiving new reviews. */
const ROLLING: Omit<DemoReview, "hoursAgo" | "nickname">[] = [
  { app: "tidewatch", platform: "ios", rating: 5, title: "Lovely", body: "Simple and reliable, exactly what a tide app should be.", territory: "GBR", version: null },
  { app: "tidewatch", platform: "android", rating: 4, title: null, body: "Good app, would like sunrise times on the same screen.", territory: "en_GB", version: "3.4.0" },
  { app: "moorland-notes", platform: "ios", rating: 3, title: "Fine", body: "Does the job. Tags would make it much better.", territory: "NZL", version: null },
  { app: "signal-box", platform: "android", rating: 2, title: "Crash on map", body: "Opening the map view crashes the app straight away.", territory: "en_IE", version: "2.0.1" },
];

const NICKNAMES = ["sea_glass_sid", "mizzle_mo", "drizzle_dan", "harbour_hen", "estuary_ed", "creek_kit"];
const BUCKET_MS = 8 * HOUR;

export function demoReviews(appId: string, platform: "ios" | "android", now: Date): ReviewInput[] {
  const out: ReviewInput[] = [];
  REVIEWS.forEach((r, i) => {
    if (r.app !== appId || r.platform !== platform) return;
    out.push({
      storeId: `demo-${appId}-${i}`,
      platform,
      rating: r.rating,
      title: r.title,
      body: r.body,
      reviewer: r.nickname,
      territory: r.territory,
      appVersion: r.version,
      createdAt: new Date(now.getTime() - r.hoursAgo * HOUR).toISOString(),
    });
  });
  // One rolling review per eight hour bucket, for the most recent day.
  const current = Math.floor(now.getTime() / BUCKET_MS);
  for (let bucket = current - 2; bucket <= current; bucket++) {
    const template = ROLLING[bucket % ROLLING.length];
    if (!template || template.app !== appId || template.platform !== platform) continue;
    out.push({
      storeId: `demo-rolling-${bucket}`,
      platform,
      rating: template.rating,
      title: template.title,
      body: template.body,
      reviewer: NICKNAMES[bucket % NICKNAMES.length] ?? null,
      territory: template.territory,
      appVersion: template.version,
      createdAt: new Date(bucket * BUCKET_MS + HOUR).toISOString(),
    });
  }
  return out;
}

const iso = (ms: number) => new Date(ms).toISOString();
const dateOnly = (ms: number) => iso(ms).slice(0, 10);

export class DemoStoreProvider implements StoreProvider {
  constructor(
    readonly name: "appstore" | "googleplay",
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get platform() {
    return this.name === "appstore" ? ("ios" as const) : ("android" as const);
  }

  handles(app: App): boolean {
    return this.name === "appstore" ? Boolean(app.appstoreId) : Boolean(app.playPackage);
  }

  async fetchReviews(app: App): Promise<ReviewInput[]> {
    return demoReviews(app.id, this.platform, this.now());
  }

  async fetchVersions(app: App): Promise<StoreVersion[]> {
    const t = this.now().getTime();
    const table: Record<string, StoreVersion[]> = {
      "appstore:tidewatch": [
        { key: "v340", platform: "ios", version: "3.4.0", state: "waiting for review", releaseDate: dateOnly(t + 5 * DAY) },
        { key: "v332", platform: "ios", version: "3.3.2", state: "live", releaseDate: dateOnly(t - 18 * DAY) },
      ],
      "googleplay:tidewatch": [
        { key: "production:340", platform: "android", version: "3.4.0", state: "rolling out 20%", releaseDate: dateOnly(t - 1 * DAY) },
      ],
      "appstore:moorland-notes": [
        { key: "v120", platform: "ios", version: "1.2.0", state: "live", releaseDate: dateOnly(t - 33 * DAY) },
      ],
      "googleplay:signal-box": [
        { key: "production:201", platform: "android", version: "2.0.1", state: "live", releaseDate: dateOnly(t - 9 * DAY) },
        { key: "internal:210", platform: "android", version: "2.1.0-beta2", state: "internal: live", releaseDate: dateOnly(t - 2 * DAY) },
      ],
    };
    return table[`${this.name}:${app.id}`] ?? [];
  }
}

export class DemoSigningProvider implements SigningAssetsProvider {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async fetchExpiries(): Promise<ExpiryInput[]> {
    const t = this.now().getTime();
    return [
      { id: "asc-cert:demo-dist", kind: "certificate", label: "Apple Distribution certificate", expiresAt: iso(t + 212 * DAY), detail: "DISTRIBUTION" },
      { id: "asc-cert:demo-push", kind: "certificate", label: "Push notification certificate (Tidewatch)", expiresAt: iso(t + 26 * DAY), detail: "APNS" },
      { id: "asc-profile:demo-tide", kind: "profile", label: "Tidewatch App Store profile", expiresAt: iso(t + 212 * DAY), detail: "IOS_APP_STORE" },
      { id: "asc-profile:demo-moor-dev", kind: "profile", label: "Moorland Notes development profile", expiresAt: iso(t + 6 * DAY), detail: "IOS_APP_DEVELOPMENT" },
    ];
  }
}

/**
 * Fake HTTP probe. Latency wanders around a per-host baseline. The sync
 * host has a short outage every few hours so incidents can be seen.
 */
export class DemoUptimeProvider implements UptimeProvider {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async probe(req: ProbeRequest): Promise<ProbeResult> {
    return demoProbe(req.url, this.now());
  }
}

export function demoProbe(url: string, at: Date): ProbeResult {
  const slot = Math.floor(at.getTime() / (5 * 60_000));
  const base = 40 + (hash(url) % 160);
  const jitter = hash(`${url}#${slot}`) % 90;
  const latencyMs = base + jitter;
  if (url.includes("sync.") && slot % 40 < 3) {
    return { ok: false, statusCode: 503, latencyMs: latencyMs + 400, error: "HTTP 503 (expected 2xx or 3xx)" };
  }
  if (url.includes("hooks.") && slot % 97 === 0) {
    return { ok: false, statusCode: null, latencyMs: 10_000, error: "Timed out after 10000 ms" };
  }
  return { ok: true, statusCode: 200, latencyMs, error: null };
}

export class DemoTlsProvider implements TlsProvider {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async lookup(hostname: string): Promise<CertificateInfo | null> {
    const t = this.now().getTime();
    const days = 4 + (hash(hostname) % 80);
    return {
      hostname,
      notBefore: iso(t - (90 - days) * DAY),
      notAfter: iso(t + days * DAY),
      issuer: hash(hostname) % 2 ? "Let's Encrypt" : "Google Trust Services",
    };
  }
}

export class DemoSupabaseProvider implements SupabaseProvider {
  async fetchProjects(): Promise<SupabaseProjectInput[]> {
    return [
      {
        ref: "demoprojtidewatch01",
        name: "tidewatch-production",
        region: "eu-west-2",
        status: "ACTIVE_HEALTHY",
        services: [
          { name: "db", healthy: true, status: "ACTIVE_HEALTHY" },
          { name: "auth", healthy: true, status: "ACTIVE_HEALTHY" },
          { name: "rest", healthy: true, status: "ACTIVE_HEALTHY" },
          { name: "storage", healthy: true, status: "ACTIVE_HEALTHY" },
        ],
        dbSizeBytes: 327_155_712,
      },
      {
        ref: "demoprojmoorland02",
        name: "moorland-notes-sync",
        region: "eu-west-1",
        status: "ACTIVE_HEALTHY",
        services: [
          { name: "db", healthy: true, status: "ACTIVE_HEALTHY" },
          { name: "auth", healthy: true, status: "ACTIVE_HEALTHY" },
          { name: "rest", healthy: true, status: "ACTIVE_HEALTHY" },
          { name: "storage", healthy: true, status: "ACTIVE_HEALTHY" },
        ],
        dbSizeBytes: 48_234_496,
      },
      {
        ref: "demoprojsignalbx03",
        name: "signal-box-staging",
        region: "us-east-1",
        status: "INACTIVE",
        services: [],
        dbSizeBytes: null,
      },
    ];
  }
}
