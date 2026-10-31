// Small date helpers. Everything stored is UTC ISO 8601; calendar dates are
// plain YYYY-MM-DD strings interpreted in the configured time zone.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function iso(date: Date): string {
  return date.toISOString();
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addDays(date: Date, days: number): Date {
  return addMs(date, days * DAY);
}

/** YYYY-MM-DD for the given instant in the given IANA time zone. */
export function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour of day (0 to 23) for the given instant in the given time zone. */
export function localHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number.parseInt(hour, 10);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Whole calendar days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetweenDates(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / DAY);
}

/** Add months to a calendar date, clamping to the end of shorter months. */
export function addMonthsToDate(date: string, months: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Not a calendar date: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1 + months;
  const day = Number(m[3]);
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return d.toISOString().slice(0, 10);
}
