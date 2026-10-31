import { useState } from "preact/hooks";
import { api } from "../api";
import { Badge, Disclosure, Dot, Empty, ErrorNote, Field, Loading, PageHeader, Sparkline, useLoad } from "../components";
import { formatDateTime, formatDuration, formatPercent, timeAgo } from "../format";
import type { Route } from "../router";
import type { CheckPoint, Endpoint, EndpointSummary, Incident } from "../../../src/shared/types";

const tone = (e: Endpoint) => (e.status === "up" ? "ok" : e.status === "down" ? "bad" : "idle");

export function Uptime(props: { route: Route }) {
  const { data, error, loading, reload } = useLoad(() => api.get<EndpointSummary[]>("/endpoints"));
  const incidents = useLoad(() => api.get<Incident[]>("/incidents?limit=20"));
  const selected = props.route.path[1];

  if (error) return <ErrorNote message={error} />;
  if (!data) return loading ? <Loading /> : null;

  return (
    <>
      <PageHeader title="Uptime" subtitle="Checked every five minutes from Cloudflare's network" />
      {data.length === 0 ? (
        <Empty>
          <p>No endpoints yet. Add one below.</p>
        </Empty>
      ) : (
        <ul class="endpoints">
          {data.map((e) => (
            <li key={e.id} class={`endpoint ${selected === e.id ? "selected" : ""}`}>
              <a class="endpoint-row" href={selected === e.id ? "#/uptime" : `#/uptime/${e.id}`} aria-expanded={selected === e.id}>
                <Dot tone={tone(e)} label={e.status} />
                <span class="endpoint-name">
                  {e.name}
                  <span class="muted endpoint-url">{e.url}</span>
                </span>
                <Sparkline points={e.recent} />
                <span class="endpoint-stat">
                  <span>{formatPercent(e.uptime24h)}</span>
                  <span class="muted">24 h</span>
                </span>
                <span class="endpoint-stat">
                  <span>{e.lastLatencyMs !== null ? `${e.lastLatencyMs} ms` : "n/a"}</span>
                  <span class="muted">{timeAgo(e.lastCheckedAt)}</span>
                </span>
              </a>
              {e.openIncident && (
                <p class="endpoint-incident">
                  Down for {formatDuration(Date.now() - Date.parse(e.openIncident.startedAt))}: {e.openIncident.cause}
                </p>
              )}
              {selected === e.id && <EndpointDetail endpoint={e} onDeleted={reload} />}
            </li>
          ))}
        </ul>
      )}

      <section class="panel">
        <h2>Recent incidents</h2>
        {incidents.data && incidents.data.length === 0 && <p class="muted">No incidents recorded.</p>}
        {incidents.data && incidents.data.length > 0 && (
          <ul class="rows">
            {incidents.data.map((i) => (
              <li key={i.id} class="row">
                <span class="row-main">{i.endpointName}</span>
                <span class="muted">{i.cause}</span>
                <span class="row-end">
                  {i.resolvedAt ? (
                    <>
                      {formatDateTime(i.startedAt)}, {formatDuration(Date.parse(i.resolvedAt) - Date.parse(i.startedAt))}
                    </>
                  ) : (
                    <Badge tone="bad">Ongoing</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Disclosure summary="Add an endpoint">
        <EndpointForm onSaved={reload} />
      </Disclosure>
    </>
  );
}

function EndpointDetail(props: { endpoint: EndpointSummary; onDeleted: () => void }) {
  const [hours, setHours] = useState(24);
  const detail = useLoad(
    () => api.get<{ checks: CheckPoint[]; incidents: Incident[] }>(`/endpoints/${props.endpoint.id}/checks?hours=${hours}`),
    [props.endpoint.id, hours],
  );
  const remove = async () => {
    if (!confirm(`Stop watching ${props.endpoint.name}? Its history will be deleted.`)) return;
    await api.del(`/endpoints/${props.endpoint.id}`);
    location.hash = "#/uptime";
    props.onDeleted();
  };
  const checks = detail.data?.checks ?? [];
  const failures = checks.filter((c) => !c.ok).length;
  const latencies = checks.map((c) => c.latencyMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null;
  const e = props.endpoint;

  return (
    <div class="endpoint-detail">
      <div class="segmented" aria-label="Time range">
        {[24, 168, 720].map((h) => (
          <button key={h} class={hours === h ? "on" : ""} aria-pressed={hours === h} onClick={() => setHours(h)}>
            {h === 24 ? "24 h" : h === 168 ? "7 days" : "30 days"}
          </button>
        ))}
      </div>
      {detail.loading && !detail.data ? <Loading /> : <Sparkline points={checks} width={640} height={80} />}
      <dl class="facts">
        <dt>Checks</dt>
        <dd>{checks.length}</dd>
        <dt>Failed</dt>
        <dd>{failures}</dd>
        <dt>95th percentile</dt>
        <dd>{p95 !== null && p95 !== undefined ? `${p95} ms` : "n/a"}</dd>
        <dt>7 day uptime</dt>
        <dd>{formatPercent(e.uptime7d)}</dd>
        <dt>Expects</dt>
        <dd>
          {e.expectedStatus ?? "2xx or 3xx"}
          {e.keyword ? `, containing "${e.keyword}"` : ""}
        </dd>
        <dt>Incident after</dt>
        <dd>
          {e.failureThreshold} failed check{e.failureThreshold === 1 ? "" : "s"}, resolved after {e.recoveryThreshold} good
        </dd>
      </dl>
      <Disclosure summary="Edit this endpoint">
        <EndpointForm endpoint={e} onSaved={props.onDeleted} />
      </Disclosure>
      <button class="link-button danger" onClick={remove}>
        Stop watching
      </button>
    </div>
  );
}

function EndpointForm(props: { endpoint?: Endpoint; onSaved: () => void }) {
  const e = props.endpoint;
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: Event) => {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget as HTMLFormElement);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    try {
      await api.post("/endpoints", {
        ...(e ? { id: e.id } : {}),
        name: get("name"),
        url: get("url"),
        expectedStatus: get("expectedStatus") || null,
        keyword: get("keyword") || null,
        timeoutMs: Number(get("timeoutMs")) || 10000,
        failureThreshold: Number(get("failureThreshold")) || 2,
        recoveryThreshold: Number(get("recoveryThreshold")) || 1,
        checkTls: form.get("checkTls") === "on",
      });
      setError(null);
      if (!e) (ev.currentTarget as HTMLFormElement).reset();
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form class="form-grid" onSubmit={submit}>
      <Field label="Name">
        <input name="name" required maxLength={80} value={e?.name} />
      </Field>
      <Field label="URL">
        <input name="url" type="url" required placeholder="https://api.example.com/health" value={e?.url} />
      </Field>
      <Field label="Expected status" hint="Leave empty to accept any 2xx or 3xx">
        <input name="expectedStatus" type="number" min={100} max={599} value={e?.expectedStatus ?? ""} />
      </Field>
      <Field label="Must contain" hint="Optional text the response body must include">
        <input name="keyword" maxLength={200} value={e?.keyword ?? ""} />
      </Field>
      <Field label="Timeout (ms)">
        <input name="timeoutMs" type="number" min={1000} max={30000} step={500} value={e?.timeoutMs ?? 10000} />
      </Field>
      <Field label="Failures before an incident">
        <input name="failureThreshold" type="number" min={1} max={10} value={e?.failureThreshold ?? 2} />
      </Field>
      <Field label="Successes to resolve">
        <input name="recoveryThreshold" type="number" min={1} max={10} value={e?.recoveryThreshold ?? 1} />
      </Field>
      <label class="check">
        <input type="checkbox" name="checkTls" defaultChecked={e?.checkTls ?? true} />
        Track TLS certificate expiry
      </label>
      {error && <p class="note note-error">{error}</p>}
      <div>
        <button class="button primary" type="submit">
          {e ? "Save changes" : "Add endpoint"}
        </button>
      </div>
    </form>
  );
}
