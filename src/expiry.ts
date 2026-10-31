// Expiry calculation: how many days are left and how loudly to say so.

import { daysBetweenDates, isCalendarDate, localDate } from "./lib/time";
import { reminderToExpiry } from "./providers/manual";
import type { ExpiryItem, ExpiryKind, Reminder, Severity } from "./shared/types";
import type { StoredExpiry } from "./db/store";

export interface Thresholds {
  /** At or below this many days left the item is urgent. */
  urgent: number;
  /** At or below this many days left the item is shown as coming up. */
  soon: number;
}

/**
 * TLS certificates usually renew themselves about 30 days out, so they only
 * become interesting much closer to the date. Agreements and memberships
 * need more notice because renewing them can involve paperwork.
 */
export const THRESHOLDS: Record<ExpiryKind, Thresholds> = {
  tls: { urgent: 5, soon: 14 },
  certificate: { urgent: 7, soon: 30 },
  profile: { urgent: 7, soon: 30 },
  domain: { urgent: 14, soon: 45 },
  agreement: { urgent: 14, soon: 45 },
  membership: { urgent: 14, soon: 45 },
  other: { urgent: 7, soon: 30 },
};

/**
 * Whole days from today to the expiry, counted in local calendar days.
 * Accepts either an ISO instant or a plain YYYY-MM-DD date.
 */
export function daysLeft(expiresAt: string, now: Date, timeZone: string): number {
  const today = localDate(now, timeZone);
  const target = isCalendarDate(expiresAt) ? expiresAt : localDate(new Date(expiresAt), timeZone);
  return daysBetweenDates(today, target);
}

export function severityFor(days: number, kind: ExpiryKind): Severity {
  const t = THRESHOLDS[kind] ?? THRESHOLDS.other;
  if (days < 0) return "expired";
  if (days <= t.urgent) return "urgent";
  if (days <= t.soon) return "soon";
  return "later";
}

const SEVERITY_ORDER: Record<Severity, number> = { expired: 0, urgent: 1, soon: 2, later: 3 };

/** Merge automatic expiries and manual reminders into one sorted list. */
export function buildExpiryList(
  stored: StoredExpiry[],
  reminders: Reminder[],
  now: Date,
  timeZone: string,
): ExpiryItem[] {
  const items: ExpiryItem[] = [];
  for (const e of stored) {
    const d = daysLeft(e.expiresAt, now, timeZone);
    items.push({
      id: e.id,
      source: e.source,
      kind: e.kind,
      label: e.label,
      expiresAt: e.expiresAt,
      detail: e.detail,
      daysLeft: d,
      severity: severityFor(d, e.kind),
      manual: false,
    });
  }
  for (const r of reminders) {
    const e = reminderToExpiry(r);
    const d = daysLeft(e.expiresAt, now, timeZone);
    items.push({
      ...e,
      source: "manual",
      daysLeft: d,
      severity: severityFor(d, e.kind),
      manual: true,
    });
  }
  return items.sort((a, b) => a.daysLeft - b.daysLeft || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Items that deserve a mention: anything that is not "later". */
export function needsAttention(items: ExpiryItem[]): ExpiryItem[] {
  return items.filter((i) => i.severity !== "later");
}
