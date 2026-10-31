// Worker bindings and settings. Values under "vars" in wrangler.jsonc are
// plain settings; everything marked secret must be set with
// `wrangler secret put` (or .dev.vars locally) and never committed.

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;

  // Settings (wrangler.jsonc "vars")
  DEMO_MODE?: string;
  PUBLIC_DEMO?: string;
  TIMEZONE?: string;
  DIGEST_PROVIDER?: string;
  DIGEST_HOUR?: string;
  KEEP_REVIEWER_NAMES?: string;
  CHECK_RETENTION_DAYS?: string;
  TLS_SOURCE?: string;
  SUPABASE_DB_SIZE?: string;
  DASHBOARD_URL?: string;
  DIGEST_EMAIL_TO?: string;
  DIGEST_EMAIL_FROM?: string;
  DIGEST_WEBHOOK_FORMAT?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  // Secrets
  ASC_ISSUER_ID?: string;
  ASC_KEY_ID?: string;
  ASC_PRIVATE_KEY?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT?: string;
  SUPABASE_ACCESS_TOKEN?: string;
  LIGHTHOUSE_PASSPHRASE?: string;
  SESSION_SECRET?: string;
  DIGEST_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
}

export type DigestProviderName = "none" | "log" | "webhook" | "resend";

export interface Config {
  demo: boolean;
  /**
   * A public, read-only demo deployment: forces demo mode, ignores every
   * credential, refuses writes and resets the invented data once a day.
   */
  publicDemo: boolean;
  timeZone: string;
  keepReviewerNames: boolean;
  checkRetentionDays: number;
  tlsSource: "crtsh" | "off";
  supabaseDbSize: boolean;
  dashboardUrl: string | null;
  digest: {
    provider: DigestProviderName;
    hour: number;
    emailTo: string | null;
    emailFrom: string | null;
    webhookFormat: "json" | "slack" | "discord";
  };
}

const truthy = (v: string | undefined) => v !== undefined && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

function int(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function validTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function readConfig(env: Env): Config {
  const publicDemo = truthy(env.PUBLIC_DEMO);
  const demo = publicDemo || truthy(env.DEMO_MODE);
  // A public demo never sends a digest, whatever else is configured.
  const provider = publicDemo ? "none" : (env.DIGEST_PROVIDER ?? "none").trim().toLowerCase();
  const format = (env.DIGEST_WEBHOOK_FORMAT ?? "json").trim().toLowerCase();
  return {
    demo,
    publicDemo,
    timeZone: validTimeZone(env.TIMEZONE),
    keepReviewerNames: truthy(env.KEEP_REVIEWER_NAMES),
    checkRetentionDays: int(env.CHECK_RETENTION_DAYS, 14, 1, 365),
    tlsSource: env.TLS_SOURCE?.trim().toLowerCase() === "off" ? "off" : "crtsh",
    supabaseDbSize: truthy(env.SUPABASE_DB_SIZE),
    dashboardUrl: env.DASHBOARD_URL?.trim() || null,
    digest: {
      provider: (["none", "log", "webhook", "resend"].includes(provider)
        ? provider
        : "none") as DigestProviderName,
      hour: int(env.DIGEST_HOUR, 8, 0, 23),
      emailTo: env.DIGEST_EMAIL_TO?.trim() || null,
      emailFrom: env.DIGEST_EMAIL_FROM?.trim() || null,
      webhookFormat: (["json", "slack", "discord"].includes(format) ? format : "json") as "json" | "slack" | "discord",
    },
  };
}
