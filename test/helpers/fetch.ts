// A tiny fake fetch for adapter tests. Routes match on method and a URL
// prefix; every request is recorded so tests can assert on headers.

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: string | null;
}

export type Handler = (req: RecordedRequest) => Response | Promise<Response>;

export function fakeFetch(routes: Record<string, Handler>) {
  const calls: RecordedRequest[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null;
    const req: RecordedRequest = { method, url, headers: new Headers(init?.headers), body };
    calls.push(req);
    // Longest matching prefix wins so specific routes beat general ones.
    const match = Object.keys(routes)
      .filter((key) => {
        const [m, prefix] = key.includes(" ") ? (key.split(" ", 2) as [string, string]) : ["GET", key];
        return m === method && url.startsWith(prefix);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return new Response(JSON.stringify({ error: `no route for ${method} ${url}` }), { status: 404 });
    return routes[match]!(req);
  };
  return { fetcher, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
