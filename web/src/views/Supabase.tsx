import { api } from "../api";
import { Badge, Dot, Empty, ErrorNote, Loading, PageHeader, useLoad } from "../components";
import { formatBytes, timeAgo } from "../format";
import type { SupabaseProject } from "../../../src/shared/types";

function statusTone(p: SupabaseProject): "ok" | "bad" | "warn" | "idle" {
  if (!p.status.startsWith("ACTIVE")) return "warn";
  if (p.healthy === false) return "bad";
  return p.healthy ? "ok" : "idle";
}

export function Supabase() {
  const { data, error, loading } = useLoad(() => api.get<SupabaseProject[]>("/supabase"));
  if (error) return <ErrorNote message={error} />;
  if (!data) return loading ? <Loading /> : null;
  return (
    <>
      <PageHeader title="Supabase" subtitle="Project status and service health from the Management API, checked hourly" />
      {data.length === 0 ? (
        <Empty>
          <p>No projects yet. Set the SUPABASE_ACCESS_TOKEN secret to start checking them.</p>
        </Empty>
      ) : (
        <ul class="projects">
          {data.map((p) => (
            <li key={p.ref} class="card project">
              <div class="project-head">
                <Dot tone={statusTone(p)} label={p.status} />
                <h2>{p.name}</h2>
                <Badge tone={p.status.startsWith("ACTIVE") ? "neutral" : "warn"}>{p.status.toLowerCase().replace(/_/g, " ")}</Badge>
              </div>
              <dl class="facts">
                <dt>Reference</dt>
                <dd>
                  <code>{p.ref}</code>
                </dd>
                <dt>Region</dt>
                <dd>{p.region ?? "n/a"}</dd>
                <dt>Database size</dt>
                <dd>{formatBytes(p.dbSizeBytes)}</dd>
                <dt>Checked</dt>
                <dd>{timeAgo(p.checkedAt)}</dd>
              </dl>
              {p.services.length > 0 && (
                <ul class="services">
                  {p.services.map((s) => (
                    <li key={s.name}>
                      <Dot tone={s.healthy ? "ok" : "bad"} label={s.healthy ? "healthy" : "unhealthy"} /> {s.name}
                    </li>
                  ))}
                </ul>
              )}
              {!p.status.startsWith("ACTIVE") && (
                <p class="muted small">Paused or inactive projects are not health-checked. Free-tier projects pause after a week without activity.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
