import { useState } from "preact/hooks";
import { api } from "../api";
import { Badge, Disclosure, Empty, ErrorNote, Field, Loading, PageHeader, useLoad } from "../components";
import { daysText, expiryDetail, formatDate, KIND_LABEL } from "../format";
import type { ExpiryItem, Severity } from "../../../src/shared/types";

const SEVERITY_TONE: Record<Severity, "bad" | "warn" | "neutral" | "ok"> = {
  expired: "bad",
  urgent: "bad",
  soon: "warn",
  later: "neutral",
};

export function Expiries() {
  const { data, error, loading, reload } = useLoad(() => api.get<ExpiryItem[]>("/expiries"));
  const [showLater, setShowLater] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!data) return loading ? <Loading /> : null;

  const pressing = data.filter((i) => i.severity !== "later");
  const later = data.filter((i) => i.severity === "later");

  const done = async (item: ExpiryItem) => {
    const id = item.id.replace(/^reminder:/, "");
    const label = item.repeat && item.repeat !== "none" ? "Mark as renewed? It will move to the next due date." : "Mark as done? The reminder will be removed.";
    if (!confirm(label)) return;
    await api.post(`/reminders/${id}/done`);
    reload();
  };

  const remove = async (item: ExpiryItem) => {
    if (!confirm(`Delete the reminder "${item.label}"?`)) return;
    await api.del(`/reminders/${item.id.replace(/^reminder:/, "")}`);
    reload();
  };

  const row = (i: ExpiryItem) => (
    <li key={i.id} class="row expiry">
      <span class="row-main">
        {i.label}
        <span class="muted expiry-kind">
          {KIND_LABEL[i.kind] ?? i.kind}
          {i.detail ? `, ${expiryDetail(i.detail)}` : ""}
          {i.repeat && i.repeat !== "none" ? `, repeats ${i.repeat}` : ""}
        </span>
      </span>
      <span class="muted">{formatDate(i.expiresAt)}</span>
      <span class="row-end">
        <Badge tone={SEVERITY_TONE[i.severity]}>{daysText(i.daysLeft)}</Badge>
        {i.manual && (
          <>
            <button class="link-button" onClick={() => done(i)}>
              Done
            </button>
            <button class="link-button danger" onClick={() => remove(i)}>
              Delete
            </button>
          </>
        )}
      </span>
    </li>
  );

  return (
    <>
      <PageHeader title="Expiries" subtitle="Certificates, profiles, domains, agreements and anything else with a date" />
      {pressing.length === 0 ? (
        <Empty>
          <p class="calm">Nothing is expiring soon.</p>
        </Empty>
      ) : (
        <ul class="rows">{pressing.map(row)}</ul>
      )}
      {later.length > 0 && (
        <section class="panel">
          <button class="link-button" onClick={() => setShowLater(!showLater)} aria-expanded={showLater}>
            {showLater ? "Hide" : "Show"} {later.length} further away
          </button>
          {showLater && <ul class="rows">{later.map(row)}</ul>}
        </section>
      )}
      <Disclosure summary="Add a reminder">
        <ReminderForm onSaved={reload} />
      </Disclosure>
      <p class="muted small">
        The Apple developer agreement, programme membership and domain renewals cannot be read from any API Lighthouse uses, so add them here as reminders.
      </p>
    </>
  );
}

function ReminderForm(props: { onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: Event) => {
    ev.preventDefault();
    const formEl = ev.currentTarget as HTMLFormElement;
    const form = new FormData(formEl);
    try {
      await api.post("/reminders", {
        title: form.get("title"),
        kind: form.get("kind"),
        dueOn: form.get("dueOn"),
        repeat: form.get("repeat"),
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
      <Field label="What">
        <input name="title" required maxLength={120} placeholder="Renew example.com" />
      </Field>
      <Field label="Kind">
        <select name="kind">
          <option value="domain">Domain</option>
          <option value="agreement">Agreement</option>
          <option value="membership">Membership</option>
          <option value="certificate">Certificate</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Due on">
        <input name="dueOn" type="date" required />
      </Field>
      <Field label="Repeats">
        <select name="repeat">
          <option value="none">Does not repeat</option>
          <option value="yearly">Every year</option>
          <option value="monthly">Every month</option>
        </select>
      </Field>
      <Field label="Notes">
        <input name="notes" maxLength={500} />
      </Field>
      {error && <p class="note note-error">{error}</p>}
      <div>
        <button class="button primary" type="submit">
          Add reminder
        </button>
      </div>
    </form>
  );
}
