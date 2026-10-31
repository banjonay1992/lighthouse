// Digest delivery. Each sender is small and swappable; pick one with
// DIGEST_PROVIDER ("log", "webhook" or "resend").

import type { Config, Env } from "../env";
import { fetchJson } from "../providers/http";
import type { FetchLike } from "../providers/types";
import type { DigestPreview } from "../shared/types";

export interface DigestSender {
  readonly name: string;
  send(digest: DigestPreview): Promise<void>;
}

export class LogSender implements DigestSender {
  readonly name = "log";
  constructor(private readonly log: (msg: string) => void = (m) => console.log(m)) {}
  async send(digest: DigestPreview): Promise<void> {
    this.log(`${digest.subject}\n\n${digest.text}`);
  }
}

export class WebhookSender implements DigestSender {
  readonly name = "webhook";
  constructor(
    private readonly url: string,
    private readonly format: "json" | "slack" | "discord",
    private readonly fetcher: FetchLike,
  ) {}

  payload(digest: DigestPreview): unknown {
    switch (this.format) {
      case "slack":
        return { text: `*${digest.subject}*\n${digest.text}` };
      case "discord":
        return { content: `**${digest.subject}**\n${digest.text}`.slice(0, 2000) };
      case "json":
        return { subject: digest.subject, text: digest.text, html: digest.html, quiet: digest.quiet };
    }
  }

  async send(digest: DigestPreview): Promise<void> {
    const res = await this.fetcher(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.payload(digest)),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}`);
  }
}

/** Email through Resend (https://resend.com). Any HTTP email API would slot in the same way. */
export class ResendSender implements DigestSender {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string[],
    private readonly fetcher: FetchLike,
  ) {}

  async send(digest: DigestPreview): Promise<void> {
    await fetchJson(this.fetcher, "resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: this.to, subject: digest.subject, text: digest.text, html: digest.html }),
    });
  }
}

/** Returns null when no provider is configured, or a reason why it cannot be used. */
export function buildSender(env: Env, config: Config, fetcher: FetchLike): DigestSender | null | { error: string } {
  switch (config.digest.provider) {
    case "none":
      return null;
    case "log":
      return new LogSender();
    case "webhook":
      if (!env.DIGEST_WEBHOOK_URL) return { error: "DIGEST_WEBHOOK_URL is not set" };
      return new WebhookSender(env.DIGEST_WEBHOOK_URL, config.digest.webhookFormat, fetcher);
    case "resend":
      if (!env.RESEND_API_KEY || !config.digest.emailTo || !config.digest.emailFrom) {
        return { error: "Resend needs RESEND_API_KEY, DIGEST_EMAIL_TO and DIGEST_EMAIL_FROM" };
      }
      return new ResendSender(
        env.RESEND_API_KEY,
        config.digest.emailFrom,
        config.digest.emailTo.split(",").map((s) => s.trim()).filter(Boolean),
        fetcher,
      );
  }
}
