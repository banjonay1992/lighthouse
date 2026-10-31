import { describe, expect, it } from "vitest";
import { CertificateTransparencyProvider, nameCovers, pickCertificate } from "../src/providers/tls";
import { fakeFetch, json } from "./helpers/fetch";
import entries from "./fixtures/crtsh.json";

const NOW = new Date("2026-10-30T12:00:00Z");

describe("TLS expiry via Certificate Transparency", () => {
  it("matches exact names and single-label wildcards only", () => {
    expect(nameCovers("status.example.com", "status.example.com")).toBe(true);
    expect(nameCovers("*.example.com", "status.example.com")).toBe(true);
    expect(nameCovers("*.example.com", "a.b.example.com")).toBe(false);
    expect(nameCovers("*.example.com", "example.com")).toBe(false);
    expect(nameCovers("STATUS.example.com", "status.EXAMPLE.com")).toBe(true);
  });

  it("picks the most recently issued valid certificate", () => {
    const cert = pickCertificate(entries, "status.example.com", NOW);
    // The wildcard was issued most recently and covers the host.
    expect(cert).toEqual({
      hostname: "status.example.com",
      notBefore: "2026-10-20T00:00:00.000Z",
      notAfter: "2027-03-20T00:00:00.000Z",
      issuer: "Google Trust Services",
    });
    const www = pickCertificate(entries, "www.status.example.com", NOW);
    expect(www?.notAfter).toBe("2027-01-13T00:00:00.000Z");
    expect(pickCertificate(entries, "other.test", NOW)).toBeNull();
  });

  it("falls back to a wildcard query when the host has no certificate of its own", async () => {
    const { fetcher, calls } = fakeFetch({
      "https://crt.sh/?q=api.example.com": () => json([]),
      "https://crt.sh/?q=*.example.com": () => json([entries[2]]),
    });
    const provider = new CertificateTransparencyProvider(fetcher, () => NOW);
    const cert = await provider.lookup("api.example.com");
    expect(cert?.notAfter).toBe("2027-03-20T00:00:00.000Z");
    expect(calls.map((c) => decodeURIComponent(new URL(c.url).searchParams.get("q")!))).toEqual([
      "api.example.com",
      "*.example.com",
    ]);
  });

  it("returns null when nothing is logged", async () => {
    const { fetcher } = fakeFetch({ "https://crt.sh/": () => json(null) });
    expect(await new CertificateTransparencyProvider(fetcher, () => NOW).lookup("nothing.example.com")).toBeNull();
  });
});
