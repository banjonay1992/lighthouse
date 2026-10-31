import { describe, expect, it } from "vitest";
import { evaluateCheck, formatDuration, type EndpointCounters } from "../src/incidents";

const fresh: EndpointCounters = { status: "unknown", consecutiveFailures: 0, consecutiveSuccesses: 0 };
const thresholds = { failureThreshold: 2, recoveryThreshold: 2 };
const ok = { ok: true, error: null };
const fail = { ok: false, error: "HTTP 503" };

/** Feed a sequence of results through the state machine, tracking the open incident. */
function run(sequence: boolean[], t = thresholds) {
  let state = fresh;
  let open = false;
  const actions: string[] = [];
  for (const success of sequence) {
    const { next, action } = evaluateCheck(state, success ? ok : fail, t, open);
    if (action.type === "open") open = true;
    if (action.type === "resolve") open = false;
    actions.push(action.type);
    state = next;
  }
  return { state, actions, open };
}

describe("incident detection", () => {
  it("marks a healthy endpoint up", () => {
    expect(run([true]).state).toEqual({ status: "up", consecutiveFailures: 0, consecutiveSuccesses: 1 });
  });

  it("ignores a single blip", () => {
    const { state, actions } = run([true, false, true]);
    expect(actions).toEqual(["none", "none", "none"]);
    expect(state.status).toBe("up");
  });

  it("keeps the previous status while below the failure threshold", () => {
    expect(run([true, false]).state.status).toBe("up");
    expect(run([false]).state.status).toBe("unknown");
  });

  it("opens after consecutive failures and updates while still failing", () => {
    const { state, actions, open } = run([true, false, false, false]);
    expect(actions).toEqual(["none", "none", "open", "update"]);
    expect(state).toEqual({ status: "down", consecutiveFailures: 3, consecutiveSuccesses: 0 });
    expect(open).toBe(true);
  });

  it("needs consecutive successes to resolve", () => {
    const { actions, state, open } = run([false, false, true, false, true, true]);
    expect(actions).toEqual(["none", "open", "none", "update", "none", "resolve"]);
    expect(state.status).toBe("up");
    expect(open).toBe(false);
  });

  it("stays down until recovery completes", () => {
    expect(run([false, false, true]).state.status).toBe("down");
  });

  it("treats thresholds below one as one", () => {
    const { actions } = run([false, true], { failureThreshold: 0, recoveryThreshold: 0 });
    expect(actions).toEqual(["open", "resolve"]);
  });

  it("formats durations", () => {
    expect(formatDuration(4 * 60_000)).toBe("4 min");
    expect(formatDuration(130 * 60_000)).toBe("2 h 10 min");
    expect(formatDuration(120 * 60_000)).toBe("2 h");
    expect(formatDuration(72 * 3_600_000)).toBe("3 days");
  });
});
