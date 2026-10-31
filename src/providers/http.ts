import type { FetchLike } from "./types";

/** An error from a provider API, with the HTTP status when there was one. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

/** Pull a short, human readable reason out of a JSON error body. */
async function errorReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const errors = body.errors as { detail?: string; title?: string }[] | undefined;
    if (Array.isArray(errors) && errors[0]) return errors[0].detail ?? errors[0].title ?? res.statusText;
    const error = body.error as { message?: string } | string | undefined;
    if (typeof error === "string") return error;
    if (error?.message) return error.message;
    if (typeof body.message === "string") return body.message;
  } catch {
    // Not JSON; fall through.
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function fetchJson<T>(
  fetcher: FetchLike,
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetcher(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ProviderError(provider, `request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new ProviderError(provider, `${res.status} ${await errorReason(res)}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
