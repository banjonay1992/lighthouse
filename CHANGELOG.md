# Changelog

All notable changes are recorded here. The format follows Keep a Changelog and the project uses semantic versioning.

## [0.1.0] - 2026-10-31

First release.

### Added

- Cloudflare Worker with a D1 database, a single five-minute Cron Trigger and a scheduler that runs each job at its own interval.
- App Store Connect adapter for customer reviews, App Store versions, signing certificates and provisioning profiles, using ES256 tokens signed with WebCrypto.
- Google Play adapter for reviews and release tracks, using a service account and RS256 token exchange.
- Uptime checks with latency, expected status and keyword matching, and incidents that open after consecutive failures and resolve after consecutive successes.
- TLS certificate expiry from Certificate Transparency logs.
- Supabase project status, service health and optional database size from the Management API.
- Manual reminders with monthly and yearly repeats, and manually planned releases.
- Expiry list with thresholds that suit each kind of item.
- Daily digest with log, webhook (JSON, Slack, Discord) and Resend delivery.
- Single-user sign-in through Cloudflare Access verification or a passphrase with a signed session cookie.
- Preact front end: overview, reviews, uptime, expiries, release calendar, Supabase and settings, in light and dark themes.
- Demo mode with invented data, so the dashboard runs locally with no credentials.
- A public demo deployment (`wrangler deploy --env demo`) that forces demo mode, ignores every credential, refuses changes through the API and resets its invented data once a day.
- Deploys without a hard-coded D1 `database_id`: Wrangler finds or creates the database by name, and `npm run deploy` applies the migrations afterwards. Instructions for deploying with Wrangler or Workers Builds.
- Screenshots of every view in light and dark themes, taken from demo mode.
- Tests for every adapter against invented fixtures, the scheduler, incident detection, expiry calculation, the digest, authentication, the API and a front-end smoke test.
- GitHub Actions workflow for type checking, tests and builds.
