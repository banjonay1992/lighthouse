import { api } from "../api";
import { Empty, ErrorNote, Loading, PageHeader, useLoad } from "../components";
import { daysText, formatDate, PLATFORM_LABEL, timeAgo } from "../format";
import type { App, Overview as OverviewData } from "../../../src/shared/types";

export function Overview() {
  const { data, error, loading } = useLoad(() => api.get<OverviewData>("/overview"));
  const apps = useLoad(() => api.get<App[]>("/apps"));
  const appName = (id: string | null) => (id ? (apps.data?.find((a) => a.id === id)?.name ?? "") : "");
  if (error) return <ErrorNote message={error} />;
  if (!data) return loading ? <Loading /> : null;

  const lastUptime = data.jobs.find((j) => j.job === "uptime");
  return (
    <>
      <PageHeader title="Overview" subtitle={`Checks last ran ${timeAgo(lastUptime?.lastRunAt ?? null)}`} />

      <section class="attention" aria-labelledby="attention-heading">
        <h2 id="attention-heading" class="visually-hidden">Needs attention</h2>
        {data.attention.length === 0 ? (
          <Empty>
            <p class="calm">All quiet. Nothing needs your attention.</p>
          </Empty>
        ) : (
          <ul class="attention-list">
            {data.attention.map((a, i) => (
              <li key={i} class={`attention-item attention-${a.level}`}>
                <a href={a.href}>{a.message}</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div class="tiles">
        <a class="tile" href="#/reviews?unread=1">
          <span class="tile-label">Unread reviews</span>
          <span class="tile-value">{data.reviews.unread}</span>
          <span class="tile-foot">
            {data.reviews.last7d} this week
            {data.reviews.average30d !== null && <>, averaging {data.reviews.average30d.toFixed(1)}★</>}
          </span>
        </a>
        <a class="tile" href="#/uptime">
          <span class="tile-label">Endpoints</span>
          <span class="tile-value">
            {data.uptime.up}
            <span class="tile-of">/{data.uptime.total} up</span>
          </span>
          <span class="tile-foot">{data.uptime.down ? `${data.uptime.down} down` : "No open incidents"}</span>
        </a>
        <a class="tile" href="#/expiries">
          <span class="tile-label">Expiring within 30 days</span>
          <span class="tile-value">{data.expiries.within30d}</span>
          <span class="tile-foot">
            {data.expiries.next ? `Next: ${data.expiries.next.label}, ${daysText(data.expiries.next.daysLeft)}` : "Nothing tracked yet"}
          </span>
        </a>
        <a class="tile" href="#/supabase">
          <span class="tile-label">Supabase projects</span>
          <span class="tile-value">{data.supabase.total}</span>
          <span class="tile-foot">{data.supabase.unhealthy ? `${data.supabase.unhealthy} need a look` : "All healthy"}</span>
        </a>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h2>Coming up</h2>
          <a href="#/releases" class="quiet-link">Release calendar</a>
        </div>
        {data.releases.upcoming.length === 0 ? (
          <p class="muted">No releases planned in the next two weeks.</p>
        ) : (
          <ul class="rows">
            {data.releases.upcoming.map((r) => (
              <li key={r.id} class="row">
                <span class="row-main">
                  {appName(r.appId)} {r.version} <span class="muted">({PLATFORM_LABEL[r.platform]})</span>
                </span>
                <span class="muted">{r.state}</span>
                <span class="row-end">{r.releaseDate ? formatDate(r.releaseDate) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
