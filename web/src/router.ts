export interface Route {
  path: string[];
  params: URLSearchParams;
}

export function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  return { path: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}

export function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}
