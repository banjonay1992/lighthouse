// Supabase Management API adapter: project status, service health and,
// optionally, database size.
// https://supabase.com/docs/reference/api/introduction

import { fetchJson } from "./http";
import type { FetchLike, SupabaseProjectInput, SupabaseProvider } from "./types";

export const SUPABASE_API = "https://api.supabase.com";
const HEALTH_SERVICES = ["db", "auth", "rest", "storage"];

interface ProjectResponse {
  id: string;
  ref?: string;
  name: string;
  region?: string;
  status: string;
}

interface HealthResponse {
  name: string;
  healthy: boolean;
  status?: string;
}

export class SupabaseManagementProvider implements SupabaseProvider {
  constructor(
    private readonly token: string,
    private readonly fetcher: FetchLike,
    private readonly options: { includeDatabaseSize?: boolean } = {},
  ) {}

  private get headers() {
    return { authorization: `Bearer ${this.token}`, accept: "application/json" };
  }

  async fetchProjects(): Promise<SupabaseProjectInput[]> {
    const projects = await fetchJson<ProjectResponse[]>(this.fetcher, "supabase", `${SUPABASE_API}/v1/projects`, {
      headers: this.headers,
    });
    const out: SupabaseProjectInput[] = [];
    for (const p of projects) {
      const ref = p.ref ?? p.id;
      const active = p.status.startsWith("ACTIVE");
      out.push({
        ref,
        name: p.name,
        region: p.region ?? null,
        status: p.status,
        services: active ? await this.health(ref) : [],
        dbSizeBytes: active && this.options.includeDatabaseSize ? await this.databaseSize(ref) : null,
      });
    }
    return out;
  }

  private async health(ref: string) {
    const params = new URLSearchParams();
    for (const s of HEALTH_SERVICES) params.append("services", s);
    try {
      const body = await fetchJson<HealthResponse[]>(
        this.fetcher,
        "supabase",
        `${SUPABASE_API}/v1/projects/${encodeURIComponent(ref)}/health?${params}`,
        { headers: this.headers },
      );
      return body.map((s) => ({ name: s.name, healthy: Boolean(s.healthy), status: s.status }));
    } catch {
      // A failed health call should not hide the project's status.
      return [];
    }
  }

  /** Runs one read-only query. Off unless SUPABASE_DB_SIZE is "true". */
  private async databaseSize(ref: string): Promise<number | null> {
    try {
      const rows = await fetchJson<{ bytes: number | string }[]>(
        this.fetcher,
        "supabase",
        `${SUPABASE_API}/v1/projects/${encodeURIComponent(ref)}/database/query`,
        {
          method: "POST",
          headers: { ...this.headers, "content-type": "application/json" },
          body: JSON.stringify({ query: "select pg_database_size(current_database()) as bytes" }),
        },
      );
      const bytes = Number(rows[0]?.bytes);
      return Number.isFinite(bytes) ? bytes : null;
    } catch {
      return null;
    }
  }
}
