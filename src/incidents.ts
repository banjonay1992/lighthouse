// Incident detection. A pure state machine so it can be tested without a
// database: given an endpoint's current counters and a new probe result,
// work out the next counters and whether an incident opens or closes.
//
// One failed check never raises an incident on its own. An incident opens
// after `failureThreshold` consecutive failures and resolves after
// `recoveryThreshold` consecutive successes.

import type { EndpointStatus } from "./shared/types";

export interface EndpointCounters {
  status: EndpointStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface Thresholds {
  failureThreshold: number;
  recoveryThreshold: number;
}

export type IncidentAction =
  | { type: "none" }
  | { type: "open"; cause: string; failureCount: number }
  | { type: "update"; cause: string; failureCount: number }
  | { type: "resolve" };

export interface Evaluation {
  next: EndpointCounters;
  action: IncidentAction;
}

export function evaluateCheck(
  current: EndpointCounters,
  result: { ok: boolean; error: string | null },
  thresholds: Thresholds,
  hasOpenIncident: boolean,
): Evaluation {
  const failureThreshold = Math.max(1, thresholds.failureThreshold);
  const recoveryThreshold = Math.max(1, thresholds.recoveryThreshold);

  if (result.ok) {
    const successes = current.consecutiveSuccesses + 1;
    if (hasOpenIncident) {
      if (successes >= recoveryThreshold) {
        return { next: { status: "up", consecutiveFailures: 0, consecutiveSuccesses: successes }, action: { type: "resolve" } };
      }
      return { next: { status: "down", consecutiveFailures: 0, consecutiveSuccesses: successes }, action: { type: "none" } };
    }
    return { next: { status: "up", consecutiveFailures: 0, consecutiveSuccesses: successes }, action: { type: "none" } };
  }

  const failures = current.consecutiveFailures + 1;
  const cause = result.error ?? "Check failed";
  if (hasOpenIncident) {
    return {
      next: { status: "down", consecutiveFailures: failures, consecutiveSuccesses: 0 },
      action: { type: "update", cause, failureCount: failures },
    };
  }
  if (failures >= failureThreshold) {
    return {
      next: { status: "down", consecutiveFailures: failures, consecutiveSuccesses: 0 },
      action: { type: "open", cause, failureCount: failures },
    };
  }
  // A blip: keep the previous status until the threshold is reached.
  return {
    next: { status: current.status, consecutiveFailures: failures, consecutiveSuccesses: 0 },
    action: { type: "none" },
  };
}

/** Human friendly duration such as "4 min" or "2 h 10 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}
