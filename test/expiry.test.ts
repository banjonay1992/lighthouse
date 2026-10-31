import { describe, expect, it } from "vitest";
import { buildExpiryList, daysLeft, needsAttention, severityFor } from "../src/expiry";
import { advancePast, nextOccurrence } from "../src/providers/manual";
import { addMonthsToDate, isCalendarDate, localDate, localHour } from "../src/lib/time";
import type { Reminder } from "../src/shared/types";

const NOW = new Date("2026-10-30T23:30:00Z"); // 23:30 in London (GMT after the clocks change)

describe("expiry calculation", () => {
  it("counts local calendar days for instants and plain dates", () => {
    expect(daysLeft("2026-10-31", NOW, "Europe/London")).toBe(1);
    expect(daysLeft("2026-10-31T00:30:00Z", NOW, "Europe/London")).toBe(1);
    // In Tokyo it is already 31 October.
    expect(daysLeft("2026-10-31", NOW, "Asia/Tokyo")).toBe(0);
    expect(daysLeft("2026-10-29", NOW, "Europe/London")).toBe(-1);
  });

  it("uses thresholds that suit each kind", () => {
    expect(severityFor(-1, "certificate")).toBe("expired");
    expect(severityFor(0, "certificate")).toBe("urgent");
    expect(severityFor(7, "certificate")).toBe("urgent");
    expect(severityFor(8, "certificate")).toBe("soon");
    expect(severityFor(30, "certificate")).toBe("soon");
    expect(severityFor(31, "certificate")).toBe("later");
    // TLS renews itself, so 20 days out is not worth a mention.
    expect(severityFor(20, "tls")).toBe("later");
    expect(severityFor(10, "tls")).toBe("soon");
    // Agreements get more notice.
    expect(severityFor(40, "agreement")).toBe("soon");
  });

  it("merges stored expiries and reminders in date order", () => {
    const reminder: Reminder = {
      id: "r1",
      title: "Renew example.com",
      kind: "domain",
      dueOn: "2026-11-20",
      repeat: "yearly",
      notes: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const list = buildExpiryList(
      [
        { id: "tls:a", source: "tls", kind: "tls", label: "TLS a", expiresAt: "2027-01-01T00:00:00Z", detail: null, updatedAt: "" },
        { id: "asc-profile:p", source: "appstore", kind: "profile", label: "Profile", expiresAt: "2026-11-02T10:00:00Z", detail: null, updatedAt: "" },
      ],
      [reminder],
      NOW,
      "Europe/London",
    );
    expect(list.map((i) => [i.id, i.daysLeft, i.severity])).toEqual([
      ["asc-profile:p", 3, "urgent"],
      ["reminder:r1", 21, "soon"],
      ["tls:a", 63, "later"],
    ]);
    expect(list[1]).toMatchObject({ manual: true, repeat: "yearly", source: "manual" });
    expect(needsAttention(list)).toHaveLength(2);
  });
});

describe("repeating reminders", () => {
  it("rolls forward by month or year, clamping short months", () => {
    expect(nextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextOccurrence("2028-02-29", "yearly")).toBe("2029-02-28");
    expect(nextOccurrence("2026-05-01", "none")).toBeNull();
  });

  it("advances past today when marked done late", () => {
    expect(advancePast("2026-08-15", "monthly", "2026-10-30")).toBe("2026-11-15");
    expect(advancePast("2026-11-20", "yearly", "2026-10-30")).toBe("2027-11-20");
    expect(advancePast("2026-11-20", "none", "2026-10-30")).toBeNull();
  });
});

describe("time helpers", () => {
  it("handles calendar dates and zones", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-1-1")).toBe(false);
    expect(addMonthsToDate("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsToDate("2026-03-31", -1)).toBe("2026-02-28");
    expect(localDate(NOW, "UTC")).toBe("2026-10-30");
    expect(localHour(new Date("2026-07-01T07:00:00Z"), "Europe/London")).toBe(8);
  });
});
