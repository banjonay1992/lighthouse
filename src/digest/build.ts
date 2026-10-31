// Builds the daily digest from what changed since the last one. Pure: all
// data is passed in, so it is easy to test and to preview in the UI.

import { formatDuration } from "../incidents";
import type { EventRecord } from "../db/store";
import type { App, DigestPreview, ExpiryItem, Incident, Release, Review, SupabaseProject } from "../shared/types";

export interface DigestInput {
  now: Date;
  since: Date;
  timeZone: string;
  dashboardUrl: string | null;
  apps: App[];
  newReviews: Review[];
  incidents: Incident[];
  expiries: ExpiryItem[];
  upcomingReleases: Release[];
  events: EventRecord[];
  supabase: SupabaseProject[];
}

interface Section {
  title: string;
  lines: string[];
}

const PLATFORM: Record<string, string> = { ios: "iOS", android: "Android", web: "Web", other: "Other" };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Join date parts with spaces so output does not depend on the ICU version's punctuation. */
function formatParts(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", options)
    .formatToParts(date)
    .filter((p) => p.type !== "literal")
    .map((p) => p.value)
    .join(" ");
}

function formatDay(date: Date, timeZone: string): string {
  return formatParts(date, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
}

function formatShortDate(date: string): string {
  return formatParts(new Date(`${date}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

function daysPhrase(days: number): string {
  if (days < 0) return `expired ${plural(-days, "day")} ago`;
  if (days === 0) return "expires today";
  return `${plural(days, "day")} left`;
}

function reviewSection(input: DigestInput): Section | null {
  const reviews = input.newReviews;
  if (reviews.length === 0) return null;
  const names = new Map(input.apps.map((a) => [a.id, a.name]));
  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  const low = reviews.filter((r) => r.rating <= 2);
  const lines = [
    `${plural(reviews.length, "new review")}, averaging ${avg.toFixed(1)} stars.` +
      (low.length ? ` ${low.length} rated 1 or 2 stars.` : ""),
  ];
  // Low ratings first (the store sorts them that way), then a few others.
  const shown = [...low, ...reviews.filter((r) => r.rating > 2)].slice(0, 6);
  for (const r of shown) {
    const app = names.get(r.appId) ?? r.appId;
    const headline = r.title ? `${r.title}: ${r.body}` : r.body;
    lines.push(`${app} (${PLATFORM[r.platform]}), ${r.rating}★: "${truncate(headline, 140)}"`);
  }
  if (reviews.length > shown.length) lines.push(`…and ${reviews.length - shown.length} more.`);
  return { title: "Reviews", lines };
}

function uptimeSection(input: DigestInput): Section | null {
  if (input.incidents.length === 0) return null;
  const lines: string[] = [];
  for (const i of input.incidents) {
    const name = i.endpointName ?? i.endpointId;
    if (i.resolvedAt) {
      const took = formatDuration(Date.parse(i.resolvedAt) - Date.parse(i.startedAt));
      lines.push(`${name} was down for ${took} from ${formatTime(i.startedAt, input.timeZone)} (${i.cause}). Resolved.`);
    } else {
      const took = formatDuration(input.now.getTime() - Date.parse(i.startedAt));
      lines.push(`${name} is down, for ${took} so far (${i.cause}).`);
    }
  }
  return { title: "Uptime", lines };
}

function expirySection(input: DigestInput): Section | null {
  const items = input.expiries.filter((e) => e.severity !== "later");
  if (items.length === 0) return null;
  return { title: "Expiries", lines: items.map((e) => `${e.label}: ${daysPhrase(e.daysLeft)}.`) };
}

function releaseSection(input: DigestInput): Section | null {
  if (input.upcomingReleases.length === 0) return null;
  const names = new Map(input.apps.map((a) => [a.id, a.name]));
  return {
    title: "Releases this week",
    lines: input.upcomingReleases.map((r) => {
      const app = r.appId ? (names.get(r.appId) ?? r.appId) : "";
      const when = r.releaseDate ? formatShortDate(r.releaseDate) : "no date";
      return `${[app, r.version].filter(Boolean).join(" ")} (${PLATFORM[r.platform]}), ${when}: ${r.state}.`;
    }),
  };
}

function changesSection(input: DigestInput): Section | null {
  const unhealthy = input.supabase.filter((p) => p.healthy === false);
  const lines = [
    ...input.events.map((e) => (e.detail ? `${e.subject}: ${e.detail}.` : `${e.subject}.`)),
    ...unhealthy.map((p) => `Supabase project ${p.name} reports unhealthy services: ${p.services.filter((s) => !s.healthy).map((s) => s.name).join(", ")}.`),
  ];
  return lines.length ? { title: "Other changes", lines } : null;
}

export function buildDigest(input: DigestInput): DigestPreview {
  const sections = [
    uptimeSection(input),
    reviewSection(input),
    expirySection(input),
    releaseSection(input),
    changesSection(input),
  ].filter((s): s is Section => s !== null);

  const openIncidents = input.incidents.filter((i) => !i.resolvedAt).length;
  const expiring = input.expiries.filter((e) => e.severity === "expired" || e.severity === "urgent").length;
  const bits: string[] = [];
  if (openIncidents) bits.push(`${plural(openIncidents, "endpoint")} down`);
  if (input.newReviews.length) bits.push(plural(input.newReviews.length, "new review"));
  if (expiring) bits.push(`${plural(expiring, "expiry", "expiries")} due`);
  const quiet =
    input.newReviews.length === 0 &&
    input.incidents.length === 0 &&
    input.events.length === 0 &&
    !input.expiries.some((e) => e.severity !== "later") &&
    !input.supabase.some((p) => p.healthy === false);

  const subject = `Lighthouse: ${bits.length ? bits.join(", ") : quiet ? "all quiet" : "a few small changes"}`;
  const heading = `Lighthouse digest for ${formatDay(input.now, input.timeZone)}`;
  const footer = input.dashboardUrl ? `Open the dashboard: ${input.dashboardUrl}` : "";

  const textParts = [heading, ""];
  if (sections.length === 0) textParts.push("Nothing needs your attention. Everything is running as expected.", "");
  for (const s of sections) {
    textParts.push(s.title, ...s.lines.map((l) => `  - ${l}`), "");
  }
  if (footer) textParts.push(footer);
  const text = textParts.join("\n").trimEnd() + "\n";

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2933;max-width:560px;line-height:1.5">`,
    `<h1 style="font-size:18px;font-weight:600;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    sections.length === 0 ? `<p>Nothing needs your attention. Everything is running as expected.</p>` : "",
    ...sections.map(
      (s) =>
        `<h2 style="font-size:14px;font-weight:600;margin:20px 0 6px;color:#52606d">${escapeHtml(s.title)}</h2>` +
        `<ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`,
    ),
    input.dashboardUrl
      ? `<p style="margin-top:24px"><a href="${escapeHtml(input.dashboardUrl)}" style="color:#2f6f8f">Open the dashboard</a></p>`
      : "",
    `</div>`,
  ].join("");

  return { subject, text, html, quiet };
}
