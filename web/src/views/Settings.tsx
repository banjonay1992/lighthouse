import { useState } from "preact/hooks";
import { api } from "../api";
import { Badge, Disclosure, ErrorNote, Field, Loading, PageHeader, useLoad } from "../components";
import { timeAgo } from "../format";
import type { App, DigestPreview, JobRun, SessionInfo } from "../../../src/shared/types";

interface SettingsData {
  demo: boolean;
  readOnly: boolean;
  authMode: string;
  timeZone: string;
  providers: Record<string, boolean>;
  digest: { provider: string; hour: number; problem: string | null; last: { sentAt: string; delivered: boolean } | null };
  keepReviewerNames: boolean;
  checkRetentionDays: number;
  jobs: JobRun[];
}

const PROVIDER_LABELS: Record<string, string> = {
  appstore: "App Store Connect",
  googleplay: "Google Play",
  supabase: "Supabase",
  tls: "TLS expiry (Certificate Transparency)",
  uptime: "Uptime checks",
};

const JOB_LABELS: Record<string, string> = {
  uptime: "Uptime checks",
  reviews: "Store reviews",
  supabase: "Supabase status",
  versions: "Store versions",
  expiries: "Expiries and TLS",
  maintenance: "Housekeeping",
  digest: "Daily digest",
  demo_reset: "Demo data reset",
};

const AUTH_LABELS: Record<string, string> = {
  access: "Cloudflare Access",
  passphrase: "Passphrase",
  open: "Open (demo data only)",
  unconfigured: "Not configured",
};

export function Settings(props: { session: SessionInfo }) {
  const settings = useLoad(() => api.get<SettingsData>("/settings"));
  const apps = useLoad(() => api.get<App[]>("/apps"));
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [preview, setPreview] = useState<(DigestPreview & { since: string }) | null>(null);
  const [digestNote, setDigestNote] = useState<string | null>(null);

  const runNow = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.post<{ outcomes: { job: string; ok: boolean; summary: string; error: string | null }[] }>("/run", {});
      setRunResult(res.outcomes.map((o) => `${o.job}: ${o.ok ? o.summary : `failed, ${o.error}`}`).join("\n"));
      void settings.reload();
    } catch (e) {
      setRunResult((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const showPreview = async () => setPreview(await api.get("/digest/preview"));
  const sendTest = async () => {
    try {
      const res = await api.post<{ provider: string }>("/digest/test");
      setDigestNote(`Sent a test digest with ${res.provider}.`);
    } catch (e) {
      setDigestNote((e as Error).message);
    }
  };

  const removeApp = async (app: App) => {
    if (!confirm(`Remove ${app.name}? Its stored reviews and releases will be deleted.`)) return;
    await api.del(`/apps/${app.id}`);
    void apps.reload();
  };

  const signOut = async () => {
    await api.post("/logout");
    location.reload();
  };

  if (settings.error) return <ErrorNote message={settings.error} />;
  const s = settings.data;
  if (!s) return <Loading />;

  return (
    <>
      <PageHeader title="Settings" subtitle="Credentials are Worker secrets and never appear here">
        {props.session.authMode === "passphrase" && (
          <button class="button" onClick={signOut}>
            Sign out
          </button>
        )}
      </PageHeader>

      <section class="panel">
        <h2>Apps</h2>
        <ul class="rows">
          {apps.data?.map((a) => (
            <li key={a.id} class="row">
              <span class="row-main">{a.name}</span>
              <span class="muted small">
                {[a.appstoreId && `App Store ${a.appstoreId}`, a.playPackage && `Play ${a.playPackage}`].filter(Boolean).join(", ")}
              </span>
              <span class="row-end">
                <button class="link-button danger" onClick={() => removeApp(a)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        <Disclosure summary="Add an app">
          <AppForm onSaved={apps.reload} />
        </Disclosure>
      </section>

      <section class="panel">
        <h2>Connections</h2>
        <ul class="rows">
          {Object.entries(s.providers).map(([k, on]) => (
            <li key={k} class="row">
              <span class="row-main">{PROVIDER_LABELS[k] ?? k}</span>
              <span class="row-end">
                <Badge tone={on ? "ok" : "neutral"}>{on ? (s.demo ? "demo data" : "connected") : "not configured"}</Badge>
              </span>
            </li>
          ))}
          <li class="row">
            <span class="row-main">Sign-in</span>
            <span class="row-end">
              <Badge tone={s.authMode === "unconfigured" ? "bad" : "neutral"}>{AUTH_LABELS[s.authMode] ?? s.authMode}</Badge>
            </span>
          </li>
        </ul>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Scheduled jobs</h2>
          <button class="button" onClick={runNow} disabled={running}>
            {running ? "Running…" : "Run collectors now"}
          </button>
        </div>
        {s.jobs.length === 0 && <p class="muted">No jobs have run yet. The cron trigger runs every five minutes once deployed.</p>}
        <ul class="rows">
          {s.jobs.map((j) => (
            <li key={j.job} class="row">
              <span class="row-main">{JOB_LABELS[j.job] ?? j.job}</span>
              <span class="muted small">{j.lastError ?? ""}</span>
              <span class="row-end">
                <Badge tone={j.lastOk ? "ok" : "bad"}>{j.lastOk ? "ok" : "failed"}</Badge> {timeAgo(j.lastRunAt)}
              </span>
            </li>
          ))}
        </ul>
        {runResult && <pre class="output">{runResult}</pre>}
      </section>

      <section class="panel">
        <h2>Daily digest</h2>
        <p>
          Provider: <strong>{s.digest.provider}</strong>, sent after {String(s.digest.hour).padStart(2, "0")}:00 ({s.timeZone}).{" "}
          {s.digest.last && <>Last built {timeAgo(s.digest.last.sentAt)}{s.digest.last.delivered ? ", delivered" : ", not delivered"}.</>}
        </p>
        {s.digest.problem && <p class="note note-error">{s.digest.problem}</p>}
        <div class="button-row">
          <button class="button" onClick={showPreview}>
            Preview
          </button>
          <button class="button" onClick={sendTest}>
            Send a test
          </button>
        </div>
        {digestNote && <p class="note">{digestNote}</p>}
        {preview && (
          <div class="digest-preview">
            <p>
              <strong>{preview.subject}</strong>
            </p>
            <pre class="output">{preview.text}</pre>
          </div>
        )}
      </section>

      <section class="panel">
        <h2>Privacy</h2>
        <p class="small">
          Reviewer names are {s.keepReviewerNames ? "kept" : "not stored"} (KEEP_REVIEWER_NAMES). Individual uptime checks are kept for {s.checkRetentionDays} days
          (CHECK_RETENTION_DAYS).
        </p>
      </section>
    </>
  );
}

function AppForm(props: { onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: Event) => {
    ev.preventDefault();
    const formEl = ev.currentTarget as HTMLFormElement;
    const form = new FormData(formEl);
    try {
      await api.post("/apps", {
        name: form.get("name"),
        appstoreId: form.get("appstoreId") || null,
        playPackage: form.get("playPackage") || null,
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
      <Field label="Name">
        <input name="name" required maxLength={80} />
      </Field>
      <Field label="App Store Apple ID" hint="The number in the App Store Connect URL or App Information page">
        <input name="appstoreId" inputMode="numeric" pattern="\d{5,15}" />
      </Field>
      <Field label="Google Play package" hint="For example com.example.app">
        <input name="playPackage" />
      </Field>
      {error && <p class="note note-error">{error}</p>}
      <div>
        <button class="button primary" type="submit">
          Add app
        </button>
      </div>
    </form>
  );
}
