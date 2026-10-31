// Hand-rolled validation for request bodies. Small on purpose: the API has
// a handful of forms and each rule is easier to read inline than in a schema
// library.

import { isCalendarDate } from "../lib/time";
import { HttpError } from "./http";

type Body = Record<string, unknown>;

export function requiredString(body: Body, key: string, max: number): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(400, `${key} is required`);
  if (v.length > max) throw new HttpError(400, `${key} must be at most ${max} characters`);
  return v.trim();
}

export function optionalString(body: Body, key: string, max: number): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new HttpError(400, `${key} must be text`);
  if (v.length > max) throw new HttpError(400, `${key} must be at most ${max} characters`);
  return v.trim() || null;
}

export function optionalInt(body: Body, key: string, min: number, max: number, fallback: number | null): number | null {
  const v = body[key];
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${key} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], fallback?: T): T {
  const v = body[key];
  if ((v === undefined || v === null || v === "") && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new HttpError(400, `${key} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

export function calendarDate(body: Body, key: string, required: boolean): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new HttpError(400, `${key} is required`);
    return null;
  }
  if (typeof v !== "string" || !isCalendarDate(v)) throw new HttpError(400, `${key} must be a date (YYYY-MM-DD)`);
  return v;
}

export function httpUrl(body: Body, key: string): string {
  const raw = requiredString(body, key, 2000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, `${key} must be a full URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, `${key} must use http or https`);
  if (url.username || url.password) throw new HttpError(400, `${key} must not contain credentials`);
  return url.toString();
}

export function stringArray(body: Body, key: string, maxItems: number, maxLength: number): string[] {
  const v = body[key];
  if (!Array.isArray(v)) throw new HttpError(400, `${key} must be a list`);
  if (v.length > maxItems) throw new HttpError(400, `${key} has too many items`);
  return v.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > maxLength) {
      throw new HttpError(400, `${key} contains an invalid item`);
    }
    return item;
  });
}

export const APPSTORE_ID = /^\d{5,15}$/;
export const PLAY_PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
