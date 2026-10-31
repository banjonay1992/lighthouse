// The "manual" provider: things Lighthouse cannot discover by itself, such
// as domain renewals and the Apple developer agreement, entered as
// reminders. This module turns reminders into expiry items and works out
// the next occurrence of repeating ones.

import { addMonthsToDate } from "../lib/time";
import type { Reminder, RepeatRule } from "../shared/types";
import type { ExpiryInput } from "./types";

/** The due date after `dueOn` for a repeating reminder, or null for one-offs. */
export function nextOccurrence(dueOn: string, repeat: RepeatRule): string | null {
  switch (repeat) {
    case "monthly":
      return addMonthsToDate(dueOn, 1);
    case "yearly":
      return addMonthsToDate(dueOn, 12);
    case "none":
      return null;
  }
}

/**
 * Roll a repeating reminder forward until it is due on or after `today`.
 * Used when a reminder is marked done, so a renewal done early or late
 * lands on the right next date.
 */
export function advancePast(dueOn: string, repeat: RepeatRule, today: string): string | null {
  let next = nextOccurrence(dueOn, repeat);
  if (!next) return null;
  while (next <= today) {
    const again = nextOccurrence(next, repeat);
    if (!again) break;
    next = again;
  }
  return next;
}

/** Reminders are due at the start of the day in the dashboard's time zone. */
export function reminderToExpiry(r: Reminder): ExpiryInput & { repeat: RepeatRule } {
  return {
    id: `reminder:${r.id}`,
    kind: r.kind,
    label: r.title,
    expiresAt: r.dueOn,
    detail: r.notes,
    repeat: r.repeat,
  };
}
