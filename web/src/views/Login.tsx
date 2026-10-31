import { useState } from "preact/hooks";
import { api } from "../api";
import type { SessionInfo } from "../../../src/shared/types";

export function Login(props: { session: SessionInfo; onSignedIn: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (props.session.authMode === "access") {
    return (
      <main class="centre">
        <div class="card narrow">
          <h1>Lighthouse</h1>
          <p>This dashboard is protected by Cloudflare Access, but this request did not carry a valid Access token. Reload the page to sign in again.</p>
        </div>
      </main>
    );
  }

  if (props.session.authMode === "unconfigured") {
    return (
      <main class="centre">
        <div class="card narrow">
          <h1>Lighthouse</h1>
          <p>Sign-in has not been set up yet. Configure Cloudflare Access, or set the <code>LIGHTHOUSE_PASSPHRASE</code> and <code>SESSION_SECRET</code> secrets. The README explains both.</p>
        </div>
      </main>
    );
  }

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/login", { passphrase });
      props.onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="centre">
      <form class="card narrow" onSubmit={submit}>
        <h1>Lighthouse</h1>
        <label class="field">
          <span class="field-label">Passphrase</span>
          <input type="password" autoComplete="current-password" value={passphrase} onInput={(e) => setPassphrase(e.currentTarget.value)} autoFocus required />
        </label>
        {error && <p class="note note-error">{error}</p>}
        <button class="button primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
