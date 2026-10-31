// Formatting helpers. British English, no surprises.

export { supabaseStatus } from "../../src/shared/labels";

const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso);
}

export function formatDate(value: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : undefined });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null) return "n/a";
  const pct = ratio * 100;
  return `${pct >= 99.95 ? "100" : pct.toFixed(pct >= 99 ? 2 : 1)}%`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function daysText(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", android: "Android", web: "Web", other: "Other" };

export const KIND_LABEL: Record<string, string> = {
  certificate: "Signing certificate",
  profile: "Provisioning profile",
  tls: "TLS certificate",
  domain: "Domain",
  agreement: "Agreement",
  membership: "Membership",
  other: "Reminder",
};

/** Apple certificate and profile types, as App Store Connect reports them. */
const SIGNING_TYPE_LABEL: Record<string, string> = {
  DEVELOPMENT: "Apple Development",
  DISTRIBUTION: "Apple Distribution",
  IOS_DEVELOPMENT: "iOS Development",
  IOS_DISTRIBUTION: "iOS Distribution",
  MAC_APP_DEVELOPMENT: "Mac Development",
  MAC_APP_DISTRIBUTION: "Mac App Distribution",
  MAC_INSTALLER_DISTRIBUTION: "Mac Installer Distribution",
  DEVELOPER_ID_APPLICATION: "Developer ID Application",
  DEVELOPER_ID_KEXT: "Developer ID Kernel Extension",
  PASS_TYPE_ID: "Pass Type ID",
  PASS_TYPE_ID_WITH_NFC: "Pass Type ID with NFC",
  IOS_APP_DEVELOPMENT: "iOS development",
  IOS_APP_STORE: "iOS App Store",
  IOS_APP_ADHOC: "iOS ad hoc",
  IOS_APP_INHOUSE: "iOS in-house",
  MAC_APP_STORE: "Mac App Store",
  MAC_APP_DIRECT: "Mac direct distribution",
  TVOS_APP_DEVELOPMENT: "tvOS development",
  TVOS_APP_STORE: "tvOS App Store",
  TVOS_APP_ADHOC: "tvOS ad hoc",
};

/** Turn an expiry's detail into something readable: known Apple types get a label, notes lose a trailing full stop. */
export function expiryDetail(detail: string | null): string | null {
  if (!detail) return null;
  const known = SIGNING_TYPE_LABEL[detail];
  if (known) return known;
  return detail.trim().replace(/[.\s]+$/, "");
}
