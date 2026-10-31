// Thin wrapper around fetch for the Lighthouse API.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let readOnly = false;

/** On a public demo every change is refused, so do not even send it. */
export function setReadOnly(value: boolean): void {
  readOnly = value;
}

export function isReadOnly(): boolean {
  return readOnly;
}

export const READ_ONLY_MESSAGE = "This is a read-only demo, so changes are switched off.";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (readOnly && method !== "GET") throw new ApiError(403, READ_ONLY_MESSAGE);
  const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json" } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "content-type": "application/json" };
  }
  const res = await fetch(`/api${path}`, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page.
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    if (res.status === 401) window.dispatchEvent(new CustomEvent("lighthouse:unauthorised"));
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
