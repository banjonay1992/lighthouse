// Typed access to the D1 database. All SQL lives here so the rest of the
// Worker deals only in plain objects.

import type {
  App,
  CheckPoint,
  Endpoint,
  EndpointStatus,
  ExpiryKind,
  Incident,
  JobRun,
  Platform,
  Release,
  ReleasePlatform,
  ReleaseSource,
  Reminder,
  RepeatRule,
  Review,
  SupabaseProject,
  SupabaseService,
} from "../shared/types";
import type { ExpiryInput, ReviewInput, StoreVersion, SupabaseProjectInput } from "../providers/types";

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toApp(r: Row): App {
  return {
    id: str(r.id),
    name: str(r.name),
    appstoreId: strOrNull(r.appstore_id),
    playPackage: strOrNull(r.play_package),
    createdAt: str(r.created_at),
  };
}

function toReview(r: Row): Review {
  return {
    id: str(r.id),
    appId: str(r.app_id),
    platform: str(r.platform) as Platform,
    rating: Number(r.rating),
    title: strOrNull(r.title),
    body: str(r.body),
    reviewer: strOrNull(r.reviewer),
    territory: strOrNull(r.territory),
    appVersion: strOrNull(r.app_version),
    createdAt: str(r.created_at),
    fetchedAt: str(r.fetched_at),
    readAt: strOrNull(r.read_at),
  };
}

function toEndpoint(r: Row): Endpoint {
  return {
    id: str(r.id),
    name: str(r.name),
    url: str(r.url),
    expectedStatus: numOrNull(r.expected_status),
    keyword: strOrNull(r.keyword),
    timeoutMs: Number(r.timeout_ms),
    checkTls: Number(r.check_tls) === 1,
    failureThreshold: Number(r.failure_threshold),
    recoveryThreshold: Number(r.recovery_threshold),
    status: str(r.status) as EndpointStatus,
    consecutiveFailures: Number(r.consecutive_failures),
    consecutiveSuccesses: Number(r.consecutive_successes),
    lastCheckedAt: strOrNull(r.last_checked_at),
    lastLatencyMs: numOrNull(r.last_latency_ms),
    createdAt: str(r.created_at),
  };
}

function toIncident(r: Row): Incident {
  const incident: Incident = {
    id: Number(r.id),
    endpointId: str(r.endpoint_id),
    startedAt: str(r.started_at),
    resolvedAt: strOrNull(r.resolved_at),
    cause: str(r.cause),
    failureCount: Number(r.failure_count),
  };
  if (r.endpoint_name !== undefined) incident.endpointName = strOrNull(r.endpoint_name) ?? undefined;
  return incident;
}

function toReminder(r: Row): Reminder {
  return {
    id: str(r.id),
    title: str(r.title),
    kind: str(r.kind) as ExpiryKind,
    dueOn: str(r.due_on),
    repeat: str(r.repeat) as RepeatRule,
    notes: strOrNull(r.notes),
    createdAt: str(r.created_at),
  };
}

function toRelease(r: Row): Release {
  return {
    id: str(r.id),
    appId: strOrNull(r.app_id),
    platform: str(r.platform) as ReleasePlatform,
    version: str(r.version),
    state: str(r.state),
    releaseDate: strOrNull(r.release_date),
    source: str(r.source) as ReleaseSource,
    notes: strOrNull(r.notes),
    updatedAt: str(r.updated_at),
  };
}

function parseServices(raw: unknown): SupabaseService[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SupabaseService[]) : [];
  } catch {
    return [];
  }
}

function toSupabase(r: Row): SupabaseProject {
  return {
    ref: str(r.ref),
    name: str(r.name),
    region: strOrNull(r.region),
    status: str(r.status),
    healthy: r.healthy === null || r.healthy === undefined ? null : Number(r.healthy) === 1,
    services: parseServices(r.services),
    dbSizeBytes: numOrNull(r.db_size_bytes),
    checkedAt: str(r.checked_at),
  };
}

export interface ReviewFilter {
  appId?: string;
  platform?: Platform;
  ratings?: number[];
  unreadOnly?: boolean;
  limit?: number;
  /** Opaque cursor from a previous page: "<createdAt>|<id>". */
  cursor?: string;
}

export interface StoredExpiry extends ExpiryInput {
  source: string;
  updatedAt: string;
}

export interface EventRecord {
  id: number;
  at: string;
  kind: string;
  subject: string;
  detail: string | null;
}

export class Store {
  constructor(private readonly db: D1Database) {}

  // ---- apps ---------------------------------------------------------------

  async listApps(): Promise<App[]> {
    const { results } = await this.db.prepare("SELECT * FROM apps ORDER BY name COLLATE NOCASE").all<Row>();
    return results.map(toApp);
  }

  async getApp(id: string): Promise<App | null> {
    const row = await this.db.prepare("SELECT * FROM apps WHERE id = ?").bind(id).first<Row>();
    return row ? toApp(row) : null;
  }

  async upsertApp(app: App): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO apps (id, name, appstore_id, play_package, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, appstore_id = excluded.appstore_id,
           play_package = excluded.play_package`,
      )
      .bind(app.id, app.name, app.appstoreId, app.playPackage, app.createdAt)
      .run();
  }

  async deleteApp(id: string): Promise<boolean> {
    const res = await this.db.prepare("DELETE FROM apps WHERE id = ?").bind(id).run();
    return res.meta.changes > 0;
  }

  // ---- reviews ------------------------------------------------------------

  /** Insert reviews that are not already stored. Returns how many were new. */
  async insertReviews(appId: string, reviews: ReviewInput[], fetchedAt: string, keepNames: boolean): Promise<number> {
    if (reviews.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO reviews
         (id, app_id, platform, rating, title, body, reviewer, territory, app_version, created_at, fetched_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    const results = await this.db.batch(
      reviews.map((r) =>
        stmt.bind(
          `${r.platform}:${r.storeId}`,
          appId,
          r.platform,
          Math.min(5, Math.max(1, Math.round(r.rating))),
          r.title,
          r.body,
          keepNames ? r.reviewer : null,
          r.territory,
          r.appVersion,
          r.createdAt,
          fetchedAt,
        ),
      ),
    );
    return results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
  }

  async listReviews(filter: ReviewFilter): Promise<{ reviews: Review[]; nextCursor: string | null }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.appId) {
      where.push("app_id = ?");
      params.push(filter.appId);
    }
    if (filter.platform) {
      where.push("platform = ?");
      params.push(filter.platform);
    }
    if (filter.ratings && filter.ratings.length > 0) {
      where.push(`rating IN (${filter.ratings.map(() => "?").join(", ")})`);
      params.push(...filter.ratings);
    }
    if (filter.unreadOnly) where.push("read_at IS NULL");
    if (filter.cursor) {
      const sep = filter.cursor.lastIndexOf("|");
      if (sep > 0) {
        where.push("(created_at < ? OR (created_at = ? AND id < ?))");
        const at = filter.cursor.slice(0, sep);
        params.push(at, at, filter.cursor.slice(sep + 1));
      }
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const sql = `SELECT * FROM reviews ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC LIMIT ?`;
    const { results } = await this.db
      .prepare(sql)
      .bind(...params, limit + 1)
      .all<Row>();
    const rows = results.map(toReview);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return { reviews: page, nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null };
  }

  async countUnreadReviews(appId?: string): Promise<number> {
    const row = appId
      ? await this.db
          .prepare("SELECT COUNT(*) AS n FROM reviews WHERE read_at IS NULL AND app_id = ?")
          .bind(appId)
          .first<Row>()
      : await this.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE read_at IS NULL").first<Row>();
    return Number(row?.n ?? 0);
  }

  async reviewStats(now: Date): Promise<{ unread: number; lowRatedUnread: number; last7d: number; average30d: number | null }> {
    const d7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const row = await this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread,
           SUM(CASE WHEN read_at IS NULL AND rating <= 2 THEN 1 ELSE 0 END) AS low_unread,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7d,
           AVG(CASE WHEN created_at >= ? THEN rating END) AS avg30d
         FROM reviews`,
      )
      .bind(d7, d30)
      .first<Row>();
    return {
      unread: Number(row?.unread ?? 0),
      lowRatedUnread: Number(row?.low_unread ?? 0),
      last7d: Number(row?.last7d ?? 0),
      average30d: row?.avg30d === null || row?.avg30d === undefined ? null : Math.round(Number(row.avg30d) * 10) / 10,
    };
  }

  async reviewsFetchedSince(since: string): Promise<Review[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM reviews WHERE fetched_at > ? ORDER BY rating ASC, created_at DESC")
      .bind(since)
      .all<Row>();
    return results.map(toReview);
  }

  async markReviewsRead(ids: string[], at: string): Promise<number> {
    if (ids.length === 0) return 0;
    const stmt = this.db.prepare("UPDATE reviews SET read_at = ? WHERE id = ? AND read_at IS NULL");
    const results = await this.db.batch(ids.map((id) => stmt.bind(at, id)));
    return results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
  }

  async markReviewsUnread(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const stmt = this.db.prepare("UPDATE reviews SET read_at = NULL WHERE id = ?");
    const results = await this.db.batch(ids.map((id) => stmt.bind(id)));
    return results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
  }

  async markAllReviewsRead(at: string, appId?: string): Promise<number> {
    const res = appId
      ? await this.db
          .prepare("UPDATE reviews SET read_at = ? WHERE read_at IS NULL AND app_id = ?")
          .bind(at, appId)
          .run()
      : await this.db.prepare("UPDATE reviews SET read_at = ? WHERE read_at IS NULL").bind(at).run();
    return res.meta.changes;
  }

  // ---- endpoints and checks -------------------------------------------------

  async listEndpoints(): Promise<Endpoint[]> {
    const { results } = await this.db.prepare("SELECT * FROM endpoints ORDER BY name COLLATE NOCASE").all<Row>();
    return results.map(toEndpoint);
  }

  async getEndpoint(id: string): Promise<Endpoint | null> {
    const row = await this.db.prepare("SELECT * FROM endpoints WHERE id = ?").bind(id).first<Row>();
    return row ? toEndpoint(row) : null;
  }

  async upsertEndpoint(e: Endpoint): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO endpoints (id, name, url, expected_status, keyword, timeout_ms, check_tls,
           failure_threshold, recovery_threshold, status, consecutive_failures, consecutive_successes,
           last_checked_at, last_latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, url = excluded.url,
           expected_status = excluded.expected_status, keyword = excluded.keyword,
           timeout_ms = excluded.timeout_ms, check_tls = excluded.check_tls,
           failure_threshold = excluded.failure_threshold, recovery_threshold = excluded.recovery_threshold`,
      )
      .bind(
        e.id,
        e.name,
        e.url,
        e.expectedStatus,
        e.keyword,
        e.timeoutMs,
        e.checkTls ? 1 : 0,
        e.failureThreshold,
        e.recoveryThreshold,
        e.status,
        e.consecutiveFailures,
        e.consecutiveSuccesses,
        e.lastCheckedAt,
        e.lastLatencyMs,
        e.createdAt,
      )
      .run();
  }

  async deleteEndpoint(id: string): Promise<boolean> {
    const res = await this.db.prepare("DELETE FROM endpoints WHERE id = ?").bind(id).run();
    return res.meta.changes > 0;
  }

  async saveEndpointState(
    id: string,
    state: Pick<Endpoint, "status" | "consecutiveFailures" | "consecutiveSuccesses" | "lastCheckedAt" | "lastLatencyMs">,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE endpoints SET status = ?, consecutive_failures = ?, consecutive_successes = ?,
           last_checked_at = ?, last_latency_ms = ? WHERE id = ?`,
      )
      .bind(state.status, state.consecutiveFailures, state.consecutiveSuccesses, state.lastCheckedAt, state.lastLatencyMs, id)
      .run();
  }

  async insertCheck(
    endpointId: string,
    at: string,
    result: { ok: boolean; statusCode: number | null; latencyMs: number | null; error: string | null },
  ): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO checks (endpoint_id, checked_at, ok, status_code, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(endpointId, at, result.ok ? 1 : 0, result.statusCode, result.latencyMs, result.error)
      .run();
  }

  async insertChecks(
    rows: { endpointId: string; at: string; ok: boolean; statusCode: number | null; latencyMs: number | null; error: string | null }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      "INSERT INTO checks (endpoint_id, checked_at, ok, status_code, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)",
    );
    // D1 limits the size of a batch, so insert in chunks.
    for (let i = 0; i < rows.length; i += 100) {
      await this.db.batch(
        rows.slice(i, i + 100).map((r) => stmt.bind(r.endpointId, r.at, r.ok ? 1 : 0, r.statusCode, r.latencyMs, r.error)),
      );
    }
  }

  async checksSince(endpointId: string, since: string): Promise<CheckPoint[]> {
    const { results } = await this.db
      .prepare("SELECT checked_at, ok, latency_ms FROM checks WHERE endpoint_id = ? AND checked_at >= ? ORDER BY checked_at")
      .bind(endpointId, since)
      .all<Row>();
    return results.map((r) => ({ at: str(r.checked_at), ok: Number(r.ok) === 1, latencyMs: numOrNull(r.latency_ms) }));
  }

  /** Share of successful checks since `since`, or null when there were none. */
  async uptimeSince(since: string): Promise<Map<string, number>> {
    const { results } = await this.db
      .prepare(
        "SELECT endpoint_id, AVG(ok) AS ratio FROM checks WHERE checked_at >= ? GROUP BY endpoint_id",
      )
      .bind(since)
      .all<Row>();
    return new Map(results.map((r) => [str(r.endpoint_id), Number(r.ratio)]));
  }

  async pruneChecks(before: string): Promise<number> {
    const res = await this.db.prepare("DELETE FROM checks WHERE checked_at < ?").bind(before).run();
    return res.meta.changes;
  }

  // ---- incidents ------------------------------------------------------------

  async openIncidentFor(endpointId: string): Promise<Incident | null> {
    const row = await this.db
      .prepare("SELECT * FROM incidents WHERE endpoint_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1")
      .bind(endpointId)
      .first<Row>();
    return row ? toIncident(row) : null;
  }

  async openIncident(endpointId: string, startedAt: string, cause: string, failureCount: number): Promise<number> {
    const row = await this.db
      .prepare("INSERT INTO incidents (endpoint_id, started_at, cause, failure_count) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(endpointId, startedAt, cause, failureCount)
      .first<Row>();
    return Number(row?.id);
  }

  async updateIncidentFailures(id: number, failureCount: number, cause: string): Promise<void> {
    await this.db
      .prepare("UPDATE incidents SET failure_count = ?, cause = ? WHERE id = ?")
      .bind(failureCount, cause, id)
      .run();
  }

  async resolveIncident(id: number, resolvedAt: string): Promise<void> {
    await this.db.prepare("UPDATE incidents SET resolved_at = ? WHERE id = ?").bind(resolvedAt, id).run();
  }

  async listIncidents(options: { limit?: number; endpointId?: string; since?: string } = {}): Promise<Incident[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.endpointId) {
      where.push("i.endpoint_id = ?");
      params.push(options.endpointId);
    }
    if (options.since) {
      where.push("(i.started_at >= ? OR i.resolved_at >= ? OR i.resolved_at IS NULL)");
      params.push(options.since, options.since);
    }
    const { results } = await this.db
      .prepare(
        `SELECT i.*, e.name AS endpoint_name FROM incidents i JOIN endpoints e ON e.id = i.endpoint_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY i.started_at DESC LIMIT ?`,
      )
      .bind(...params, Math.min(options.limit ?? 50, 500))
      .all<Row>();
    return results.map(toIncident);
  }

  // ---- expiries and reminders ------------------------------------------------

  /**
   * Replace every automatic expiry from one source (and optional id prefix)
   * with the given set. Items no longer reported, such as a revoked
   * certificate, disappear.
   */
  async replaceExpiries(source: string, items: ExpiryInput[], updatedAt: string, idPrefix?: string): Promise<void> {
    const stmts: D1PreparedStatement[] = [];
    const prefix = idPrefix ?? "";
    stmts.push(
      this.db
        .prepare("DELETE FROM expiries WHERE source = ? AND substr(id, 1, ?) = ?")
        .bind(source, prefix.length, prefix),
    );
    const insert = this.db.prepare(
      "INSERT INTO expiries (id, source, kind, label, expires_at, detail, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const item of items) {
      stmts.push(insert.bind(item.id, source, item.kind, item.label, item.expiresAt, item.detail, updatedAt));
    }
    await this.db.batch(stmts);
  }

  async upsertExpiry(source: string, item: ExpiryInput, updatedAt: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO expiries (id, source, kind, label, expires_at, detail, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, label = excluded.label,
           expires_at = excluded.expires_at, detail = excluded.detail, updated_at = excluded.updated_at`,
      )
      .bind(item.id, source, item.kind, item.label, item.expiresAt, item.detail, updatedAt)
      .run();
  }

  async deleteExpiry(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM expiries WHERE id = ?").bind(id).run();
  }

  async listExpiries(): Promise<StoredExpiry[]> {
    const { results } = await this.db.prepare("SELECT * FROM expiries ORDER BY expires_at").all<Row>();
    return results.map((r) => ({
      id: str(r.id),
      source: str(r.source),
      kind: str(r.kind) as ExpiryKind,
      label: str(r.label),
      expiresAt: str(r.expires_at),
      detail: strOrNull(r.detail),
      updatedAt: str(r.updated_at),
    }));
  }

  async listReminders(): Promise<Reminder[]> {
    const { results } = await this.db.prepare("SELECT * FROM reminders ORDER BY due_on").all<Row>();
    return results.map(toReminder);
  }

  async getReminder(id: string): Promise<Reminder | null> {
    const row = await this.db.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<Row>();
    return row ? toReminder(row) : null;
  }

  async upsertReminder(r: Reminder): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO reminders (id, title, kind, due_on, repeat, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, kind = excluded.kind, due_on = excluded.due_on,
           repeat = excluded.repeat, notes = excluded.notes`,
      )
      .bind(r.id, r.title, r.kind, r.dueOn, r.repeat, r.notes, r.createdAt)
      .run();
  }

  async deleteReminder(id: string): Promise<boolean> {
    const res = await this.db.prepare("DELETE FROM reminders WHERE id = ?").bind(id).run();
    return res.meta.changes > 0;
  }

  // ---- releases ---------------------------------------------------------------

  async listReleases(options: { from?: string; to?: string } = {}): Promise<Release[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.from) {
      where.push("(release_date IS NULL OR release_date >= ?)");
      params.push(options.from);
    }
    if (options.to) {
      where.push("(release_date IS NULL OR release_date <= ?)");
      params.push(options.to);
    }
    const { results } = await this.db
      .prepare(
        `SELECT * FROM releases ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY release_date IS NULL, release_date, version`,
      )
      .bind(...params)
      .all<Row>();
    return results.map(toRelease);
  }

  async getRelease(id: string): Promise<Release | null> {
    const row = await this.db.prepare("SELECT * FROM releases WHERE id = ?").bind(id).first<Row>();
    return row ? toRelease(row) : null;
  }

  async upsertRelease(r: Release): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO releases (id, app_id, platform, version, state, release_date, source, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET app_id = excluded.app_id, platform = excluded.platform,
           version = excluded.version, state = excluded.state, release_date = excluded.release_date,
           notes = excluded.notes, updated_at = excluded.updated_at`,
      )
      .bind(r.id, r.appId, r.platform, r.version, r.state, r.releaseDate, r.source, r.notes, r.updatedAt)
      .run();
  }

  async deleteRelease(id: string): Promise<boolean> {
    const res = await this.db.prepare("DELETE FROM releases WHERE id = ?").bind(id).run();
    return res.meta.changes > 0;
  }

  /**
   * Upsert versions reported by a store. Returns the versions whose state
   * changed (or which are new) so the caller can log them.
   */
  async syncStoreVersions(
    source: Exclude<ReleaseSource, "manual">,
    appId: string,
    versions: StoreVersion[],
    updatedAt: string,
  ): Promise<{ version: StoreVersion; previousState: string | null }[]> {
    const changed: { version: StoreVersion; previousState: string | null }[] = [];
    for (const v of versions) {
      const id = `${source}:${appId}:${v.key}`;
      const existing = await this.getRelease(id);
      if (!existing || existing.state !== v.state || existing.releaseDate !== v.releaseDate) {
        changed.push({ version: v, previousState: existing?.state ?? null });
        await this.upsertRelease({
          id,
          appId,
          platform: v.platform,
          version: v.version,
          state: v.state,
          releaseDate: v.releaseDate,
          source,
          notes: existing?.notes ?? null,
          updatedAt,
        });
      }
    }
    return changed;
  }

  // ---- supabase -----------------------------------------------------------------

  async listSupabaseProjects(): Promise<SupabaseProject[]> {
    const { results } = await this.db.prepare("SELECT * FROM supabase_projects ORDER BY name COLLATE NOCASE").all<Row>();
    return results.map(toSupabase);
  }

  /** Replace all stored projects, returning the previous state for comparison. */
  async replaceSupabaseProjects(projects: SupabaseProjectInput[], checkedAt: string): Promise<SupabaseProject[]> {
    const previous = await this.listSupabaseProjects();
    const insert = this.db.prepare(
      `INSERT INTO supabase_projects (ref, name, region, status, healthy, services, db_size_bytes, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const stmts: D1PreparedStatement[] = [this.db.prepare("DELETE FROM supabase_projects")];
    for (const p of projects) {
      const healthy = p.services.length === 0 ? null : p.services.every((s) => s.healthy) ? 1 : 0;
      stmts.push(
        insert.bind(p.ref, p.name, p.region, p.status, healthy, JSON.stringify(p.services), p.dbSizeBytes, checkedAt),
      );
    }
    await this.db.batch(stmts);
    return previous;
  }

  // ---- jobs, events, digests -----------------------------------------------------

  async listJobRuns(): Promise<JobRun[]> {
    const { results } = await this.db.prepare("SELECT * FROM job_runs ORDER BY job").all<Row>();
    return results.map((r) => ({
      job: str(r.job),
      lastRunAt: str(r.last_run_at),
      lastOk: Number(r.last_ok) === 1,
      lastError: strOrNull(r.last_error),
    }));
  }

  async recordJobRun(job: string, at: string, ok: boolean, error: string | null): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO job_runs (job, last_run_at, last_ok, last_error) VALUES (?, ?, ?, ?)
         ON CONFLICT (job) DO UPDATE SET last_run_at = excluded.last_run_at, last_ok = excluded.last_ok,
           last_error = excluded.last_error`,
      )
      .bind(job, at, ok ? 1 : 0, error)
      .run();
  }

  async addEvent(at: string, kind: string, subject: string, detail: string | null = null): Promise<void> {
    await this.db
      .prepare("INSERT INTO events (at, kind, subject, detail) VALUES (?, ?, ?, ?)")
      .bind(at, kind, subject, detail)
      .run();
  }

  async eventsSince(since: string): Promise<EventRecord[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM events WHERE at > ? ORDER BY at")
      .bind(since)
      .all<Row>();
    return results.map((r) => ({
      id: Number(r.id),
      at: str(r.at),
      kind: str(r.kind),
      subject: str(r.subject),
      detail: strOrNull(r.detail),
    }));
  }

  async pruneEvents(before: string): Promise<void> {
    await this.db.prepare("DELETE FROM events WHERE at < ?").bind(before).run();
  }

  async lastDigest(): Promise<{ sentAt: string; localDate: string; delivered: boolean } | null> {
    const row = await this.db
      .prepare("SELECT * FROM digests ORDER BY sent_at DESC LIMIT 1")
      .first<Row>();
    return row ? { sentAt: str(row.sent_at), localDate: str(row.local_date), delivered: Number(row.delivered) === 1 } : null;
  }

  async recordDigest(sentAt: string, localDate: string, provider: string, delivered: boolean, summary: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO digests (sent_at, local_date, provider, delivered, summary) VALUES (?, ?, ?, ?, ?)")
      .bind(sentAt, localDate, provider, delivered ? 1 : 0, summary)
      .run();
  }

  /** Delete every row. Only used to reset the invented data of a public demo. */
  async clearAll(): Promise<void> {
    const tables = [
      "reviews",
      "checks",
      "incidents",
      "releases",
      "apps",
      "endpoints",
      "expiries",
      "reminders",
      "supabase_projects",
      "job_runs",
      "events",
      "digests",
    ];
    await this.db.batch(tables.map((t) => this.db.prepare(`DELETE FROM ${t}`)));
  }

  async isEmpty(): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT (SELECT COUNT(*) FROM apps) + (SELECT COUNT(*) FROM endpoints) AS n")
      .first<Row>();
    return Number(row?.n ?? 0) === 0;
  }
}
