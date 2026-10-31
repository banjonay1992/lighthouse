// TLS certificate expiry.
//
// A Worker's fetch() does not expose the peer certificate, so Lighthouse
// cannot read the served certificate directly. Instead it looks up the
// newest unexpired certificate for the hostname in public Certificate
// Transparency logs (via crt.sh). For hosts that renew automatically this
// tracks the served certificate closely; see the README for the caveats.

import { fetchJson } from "./http";
import type { CertificateInfo, FetchLike, TlsProvider } from "./types";

interface CrtShEntry {
  issuer_name?: string;
  common_name?: string;
  name_value?: string;
  not_before?: string;
  not_after?: string;
}

/** Does a certificate name (possibly a wildcard) cover this hostname? */
export function nameCovers(certName: string, hostname: string): boolean {
  const name = certName.trim().toLowerCase();
  const host = hostname.toLowerCase();
  if (name === host) return true;
  if (name.startsWith("*.")) {
    const suffix = name.slice(1); // ".example.com"
    const dot = host.indexOf(".");
    return dot > 0 && host.slice(dot) === suffix;
  }
  return false;
}

const asUtc = (s: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s) : new Date(`${s}Z`));

/** Pick the most recently issued certificate that covers the host and is still valid. */
export function pickCertificate(entries: CrtShEntry[], hostname: string, now: Date): CertificateInfo | null {
  let best: { info: CertificateInfo; issued: number } | null = null;
  for (const e of entries) {
    if (!e.not_after || !e.not_before) continue;
    const names = (e.name_value ?? e.common_name ?? "").split("\n");
    if (!names.some((n) => nameCovers(n, hostname))) continue;
    const notAfter = asUtc(e.not_after);
    const notBefore = asUtc(e.not_before);
    if (Number.isNaN(notAfter.getTime()) || notAfter <= now || notBefore > now) continue;
    if (!best || notBefore.getTime() > best.issued) {
      best = {
        issued: notBefore.getTime(),
        info: {
          hostname,
          notAfter: notAfter.toISOString(),
          notBefore: notBefore.toISOString(),
          issuer: e.issuer_name?.match(/O=([^,]+)/)?.[1]?.trim() ?? e.issuer_name ?? null,
        },
      };
    }
  }
  return best?.info ?? null;
}

export class CertificateTransparencyProvider implements TlsProvider {
  constructor(
    private readonly fetcher: FetchLike,
    private readonly now: () => Date = () => new Date(),
    private readonly baseUrl = "https://crt.sh",
  ) {}

  private async query(q: string): Promise<CrtShEntry[]> {
    const url = `${this.baseUrl}/?q=${encodeURIComponent(q)}&output=json&exclude=expired&deduplicate=Y`;
    const body = await fetchJson<CrtShEntry[] | null>(this.fetcher, "tls", url, { timeoutMs: 20_000 });
    return Array.isArray(body) ? body : [];
  }

  async lookup(hostname: string): Promise<CertificateInfo | null> {
    const direct = pickCertificate(await this.query(hostname), hostname, this.now());
    if (direct) return direct;
    const dot = hostname.indexOf(".");
    if (dot <= 0) return null;
    return pickCertificate(await this.query(`*${hostname.slice(dot)}`), hostname, this.now());
  }
}
