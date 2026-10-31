import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./styles.css";
import { api } from "./api";
import type { SessionInfo } from "../../src/shared/types";
import { Overview } from "./views/Overview";
import { Reviews } from "./views/Reviews";
import { Uptime } from "./views/Uptime";
import { Expiries } from "./views/Expiries";
import { Releases } from "./views/Releases";
import { Supabase } from "./views/Supabase";
import { Settings } from "./views/Settings";
import { Login } from "./views/Login";
import { parseHash, type Route } from "./router";

function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

const NAV = [
  { id: "", label: "Overview" },
  { id: "reviews", label: "Reviews" },
  { id: "uptime", label: "Uptime" },
  { id: "expiries", label: "Expiries" },
  { id: "releases", label: "Releases" },
  { id: "supabase", label: "Supabase" },
  { id: "settings", label: "Settings" },
];

function App() {
  const route = useRoute();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const loadSession = () =>
    api
      .get<SessionInfo>("/session")
      .then(setSession)
      .catch((e: Error) => setFailed(e.message));

  useEffect(() => {
    void loadSession();
    const onUnauthorised = () => void loadSession();
    window.addEventListener("lighthouse:unauthorised", onUnauthorised);
    return () => window.removeEventListener("lighthouse:unauthorised", onUnauthorised);
  }, []);

  if (failed) return <main class="centre"><p class="note note-error">Could not reach the Lighthouse API: {failed}</p></main>;
  if (!session) return <main class="centre"><p class="muted">Loading…</p></main>;
  if (!session.authenticated) return <Login session={session} onSignedIn={loadSession} />;

  const section = route.path[0] ?? "";
  let view;
  switch (section) {
    case "reviews":
      view = <Reviews route={route} />;
      break;
    case "uptime":
      view = <Uptime route={route} />;
      break;
    case "expiries":
      view = <Expiries />;
      break;
    case "releases":
      view = <Releases />;
      break;
    case "supabase":
      view = <Supabase />;
      break;
    case "settings":
      view = <Settings session={session} />;
      break;
    default:
      view = <Overview />;
  }

  return (
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#/">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <span>Lighthouse</span>
        </a>
        <nav aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} class={section === n.id ? "active" : ""} aria-current={section === n.id ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        {session.demo && <p class="demo-flag">Demo mode. All data is invented.</p>}
      </aside>
      <main class="content">{view}</main>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
