import { useState } from "preact/hooks";
import { api } from "../api";
import { Badge, Disclosure, ErrorNote, Field, Loading, PageHeader, useLoad } from "../components";
import { formatDate, PLATFORM_LABEL } from "../format";
import type { App, Release } from "../../../src/shared/types";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function todayLocal(): string {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

export function Releases() {
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const apps = useLoad(() => api.get<App[]>("/apps"));
  const { data, error, loading, reload } = useLoad(() => api.get<Release[]>("/releases"));

  if (error) return <ErrorNote message={error} />;
  if (!data) return loading ? <Loading /> : null;

  const appName = (id: string | null) => (id ? (apps.data?.find((a) => a.id === id)?.name ?? id) : "");
  const byDate = new Map<string, Release[]>();
  for (const r of data) {
    if (!r.releaseDate) continue;
    byDate.set(r.releaseDate, [...(byDate.get(r.releaseDate) ?? []), r]);
  }

  const first = new Date(Date.UTC(month.y, month.m, 1));
  const daysInMonth = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = todayLocal();
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(month.y, month.m + delta, 1));
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  const upcoming = data.filter((r) => r.releaseDate && r.releaseDate >= today && r.state !== "live");
  const undated = data.filter((r) => !r.releaseDate);

  const remove = async (r: Release) => {
    if (!confirm(`Delete ${r.version}?`)) return;
    await api.del(`/releases/${r.id}`);
    reload();
  };

  return (
    <>
      <PageHeader title="Releases" subtitle="Planned by hand, plus versions read from the stores" />

      <section class="panel calendar-panel">
        <div class="panel-head">
          <button class="link-button" onClick={() => shift(-1)} aria-label="Previous month">
            ‹ Previous
          </button>
          <h2>{first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
          <button class="link-button" onClick={() => shift(1)} aria-label="Next month">
            Next ›
          </button>
        </div>
        <div class="calendar" role="grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} class="calendar-dow" role="columnheader">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={i} class="calendar-cell empty-cell" />;
            const date = ymd(month.y, month.m, day);
            const items = byDate.get(date) ?? [];
            return (
              <div key={i} class={`calendar-cell ${date === today ? "today" : ""}`} role="gridcell">
                <span class="calendar-day">{day}</span>
                {items.map((r) => (
                  <span key={r.id} class={`calendar-item platform-${r.platform}`} title={`${appName(r.appId)} ${r.version}: ${r.state}`}>
                    {appName(r.appId)} {r.version}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section class="panel">
        <h2>Upcoming</h2>
        {upcoming.length === 0 && <p class="muted">Nothing scheduled.</p>}
        <ul class="rows">
          {[...upcoming, ...undated].map((r) => (
            <li key={r.id} class="row">
              <span class="row-main">
                {appName(r.appId)} {r.version} <span class="muted">({PLATFORM_LABEL[r.platform]})</span>
                {r.notes && <span class="muted small block">{r.notes}</span>}
              </span>
              <span>
                <Badge tone={r.source === "manual" ? "neutral" : "accent"}>{r.source === "manual" ? r.state : `${r.state}, from store`}</Badge>
              </span>
              <span class="row-end">
                {r.releaseDate ? formatDate(r.releaseDate) : "no date"}
                {r.source === "manual" && (
                  <button class="link-button danger" onClick={() => remove(r)}>
                    Delete
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Disclosure summary="Plan a release">
        <ReleaseForm apps={apps.data ?? []} onSaved={reload} />
      </Disclosure>
    </>
  );
}

function ReleaseForm(props: { apps: App[]; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: Event) => {
    ev.preventDefault();
    const formEl = ev.currentTarget as HTMLFormElement;
    const form = new FormData(formEl);
    try {
      await api.post("/releases", {
        appId: form.get("appId") || null,
        platform: form.get("platform"),
        version: form.get("version"),
        state: form.get("state") || "planned",
        releaseDate: form.get("releaseDate") || null,
        notes: form.get("notes") || null,
      });
      formEl.reset();
      setError(null);
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form class="form-grid" onSubmit={submit}>
      <Field label="App">
        <select name="appId">
          <option value="">None</option>
          {props.apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Platform">
        <select name="platform">
          <option value="ios">iOS</option>
          <option value="android">Android</option>
          <option value="web">Web</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Version or title">
        <input name="version" required maxLength={60} placeholder="2.1.0" />
      </Field>
      <Field label="State">
        <input name="state" maxLength={40} placeholder="planned" />
      </Field>
      <Field label="Date">
        <input name="releaseDate" type="date" />
      </Field>
      <Field label="Notes">
        <input name="notes" maxLength={500} />
      </Field>
      {error && <p class="note note-error">{error}</p>}
      <div>
        <button class="button primary" type="submit">
          Add to calendar
        </button>
      </div>
    </form>
  );
}
