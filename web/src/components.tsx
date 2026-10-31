import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { CheckPoint } from "../../src/shared/types";

/** Load data from the API, with a reload function and quiet error state. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    return loader()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function PageHeader(props: { title: string; subtitle?: string; children?: ComponentChildren }) {
  return (
    <header class="page-header">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p class="muted">{props.subtitle}</p>}
      </div>
      {props.children && <div class="page-actions">{props.children}</div>}
    </header>
  );
}

export function Loading() {
  return <p class="muted loading">Loading…</p>;
}

export function ErrorNote(props: { message: string }) {
  return <p class="note note-error">{props.message}</p>;
}

export function Empty(props: { children: ComponentChildren }) {
  return <div class="empty">{props.children}</div>;
}

export function Stars(props: { rating: number }) {
  return (
    <span class={`stars stars-${props.rating}`} aria-label={`${props.rating} out of 5 stars`} title={`${props.rating} of 5`}>
      {"★".repeat(props.rating)}
      <span class="stars-off">{"★".repeat(5 - props.rating)}</span>
    </span>
  );
}

export function Dot(props: { tone: "ok" | "bad" | "warn" | "idle"; label?: string }) {
  return <span class={`dot dot-${props.tone}`} role="img" aria-label={props.label ?? props.tone} />;
}

export function Badge(props: { tone?: "neutral" | "bad" | "warn" | "ok" | "accent"; children: ComponentChildren }) {
  return <span class={`badge badge-${props.tone ?? "neutral"}`}>{props.children}</span>;
}

/**
 * Latency over time as a quiet line, with failed checks marked along the
 * bottom. Drawn as inline SVG so it needs no chart library.
 */
export function Sparkline(props: { points: CheckPoint[]; width?: number; height?: number }) {
  const width = props.width ?? 240;
  const height = props.height ?? 40;
  const pts = props.points;
  if (pts.length < 2) return <svg class="spark" width={width} height={height} aria-hidden="true" />;
  // Scale to successful checks only, so one timeout does not flatten the
  // whole line. Failed checks are drawn at the top and marked below.
  const okLatencies = pts.filter((p) => p.ok).map((p) => p.latencyMs ?? 0);
  const max = Math.max(...(okLatencies.length ? okLatencies : pts.map((p) => p.latencyMs ?? 0)), 1) * 1.15;
  const step = width / (pts.length - 1);
  const y = (v: number) => height - 6 - (Math.min(v, max) / max) * (height - 10);
  const line = pts.map((p, i) => `${(i * step).toFixed(1)},${y(p.latencyMs ?? 0).toFixed(1)}`).join(" ");
  return (
    <svg class="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Latency over the last 24 hours">
      <polyline points={line} fill="none" class="spark-line" />
      {pts.map((p, i) => (p.ok ? null : <rect key={i} x={i * step - 1} y={height - 4} width={2.5} height={4} class="spark-fail" />))}
    </svg>
  );
}

export function Field(props: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span class="field-hint">{props.hint}</span>}
    </label>
  );
}

/** A disclosure that keeps forms and detail out of the way until asked for. */
export function Disclosure(props: { summary: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="disclosure" open={props.open}>
      <summary>{props.summary}</summary>
      <div class="disclosure-body">{props.children}</div>
    </details>
  );
}
