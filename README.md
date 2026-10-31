# Lighthouse

Lighthouse is a self-hosted operations dashboard for a small app studio. It runs as a single Cloudflare Worker with a D1 database and puts the things you would otherwise check in six different consoles on one quiet page.

The idea is a calm surface with depth on demand. The overview shows a short list of things that need you, and nothing else shouts. Everything else is one click away when you want it.

## What it does

- **Store reviews.** New App Store and Google Play reviews for all your apps, with unread state, star filters and an app filter. Reviews are fetched hourly.
- **Uptime.** Checks your endpoints (Workers, sites, APIs) every five minutes from Cloudflare's network, records latency, and opens an incident after a run of failures rather than on a single blip. Incidents close themselves when the endpoint recovers.
- **Supabase health.** Project status (including paused projects) and per-service health from the Supabase Management API, with optional database size.
- **Expiries and deadlines.** Signing certificates and provisioning profiles from App Store Connect, TLS certificate expiry for your endpoints, and manual reminders for things no API exposes, such as domain renewals and the Apple developer agreement. Repeating reminders roll forward when you mark them done.
- **Release calendar.** Versions and their review or rollout state pulled from both stores, plus anything you plan by hand.
- **Daily digest.** Once a day, a short summary of what changed: incidents, new reviews (low ratings first), expiries that need attention, releases this week and status changes. It can be logged, posted to a webhook (plain JSON, Slack or Discord) or emailed through Resend.

## Who it is for

Solo developers and small studios with a handful of apps, a few Workers or sites and a Supabase project or two, who want one place to look each morning and are happy to deploy a Worker to their own Cloudflare account. It is single-user by design.

## Built with

- Cloudflare Workers (TypeScript) with one Cron Trigger
- Cloudflare D1 (SQLite) with plain SQL migrations
- Preact and Vite for the front end, served as Worker static assets
- WebCrypto for signing App Store Connect and Google service account tokens, so there are no runtime dependencies beyond Preact
- Vitest for tests, with Node's built-in SQLite standing in for D1 so the real migrations and queries are tested

## Run it in demo mode

You need Node.js 22.13 or later. No Cloudflare account and no credentials are needed.

```sh
npm install
npm run dev
```

Then open http://localhost:8787. Demo mode fills a local D1 database with invented apps, reviews, endpoints, reminders and Supabase projects, plus a day of uptime history. Every name, review and hostname is made up; the hostnames use the reserved `example.com`, `example.net` and `example.org` domains, and no network calls are made to any provider.

`npm run dev` builds the front end, applies the migrations to the local database and starts `wrangler dev` with `DEMO_MODE` switched on. To run the scheduled jobs by hand while it is running:

```sh
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"
```

For front-end work with hot reload, run `npm run dev` in one terminal and `npm run dev:web` in another, then use the Vite address it prints. API calls are proxied to the Worker.

To start again with fresh demo data, delete the `.wrangler` folder.

The other scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Runs the test suite |
| `npm run typecheck` | Type checks the Worker, the tests and the front end |
| `npm run build` | Builds the front end into `dist` |
| `npm run dev:live` | Like `npm run dev` but without demo mode, using your `.dev.vars` |

## Connecting your own services

Lighthouse reads credentials only from Worker secrets in production and from `.dev.vars` locally. `.dev.vars` is git-ignored; copy `.dev.vars.example` to start one. Each provider switches itself on when its secrets are present and stays off otherwise, so you can connect them one at a time. The Settings page shows which are connected and the last result of each job, including any error the provider returned.

Apps and endpoints are added in the dashboard itself: apps on the Settings page, endpoints on the Uptime page.

To try a provider locally against real data, put its secrets in `.dev.vars` and run `npm run dev:live`. You will also need a passphrase or Access configured, because outside demo mode the API refuses requests until sign-in is set up.

### App Store Connect

Lighthouse reads customer reviews, App Store versions, signing certificates and active provisioning profiles.

1. In App Store Connect, go to Users and Access, then Integrations, then App Store Connect API, and create a team key. The App Manager role covers everything Lighthouse reads. If you want something narrower, Apple's API documentation lists the roles each endpoint accepts.
2. Note the Issuer ID shown above the list of keys and the Key ID of the new key.
3. Download the `.p8` private key. Apple only lets you download it once.
4. Set the secrets:

   ```sh
   npx wrangler secret put ASC_ISSUER_ID
   npx wrangler secret put ASC_KEY_ID
   npx wrangler secret put ASC_PRIVATE_KEY < AuthKey_ABCDE12345.p8
   ```

   In `.dev.vars` the key can be written on one line with `\n` in place of newlines.
5. On the Settings page, add each app with its Apple ID (the number shown under App Information in App Store Connect).

Lighthouse signs a fresh ES256 token for each run, valid for twenty minutes, and never stores it.

### Google Play

Lighthouse reads reviews and the releases on each track.

1. In the Google Cloud console, choose or create a project and enable the Google Play Android Developer API.
2. Create a service account in that project and add a JSON key to it. Keep the downloaded file somewhere safe and out of this repository.
3. In the Play Console, go to Users and permissions and invite the service account's email address. Give it access to the apps you want to watch, with permission to view app information and to reply to reviews. Reading reviews through the API is tied to the reply permission, even though Lighthouse never replies. Reading release tracks goes through an "edit", which needs release permissions; if you leave those out, reviews still work and the version sync reports a permissions error.
4. Set the secret from the key file:

   ```sh
   npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT < service-account.json
   ```

5. On the Settings page, add the package name (for example `com.example.app`) to each app.

New permissions can take a while to reach the API. If reviews fail with a permission error straight after setup, try again later.

### Uptime

There are no secrets. Add endpoints on the Uptime page. For each one you can set the expected status code (by default any 2xx or 3xx counts as up), text the response must contain, a timeout, and how many failed checks open an incident and how many good ones close it. The defaults are two and one.

Checks run from Cloudflare's network, so they test what the public internet sees rather than what your own machine sees.

### TLS certificate expiry

There are no secrets. Every `https` endpoint with "Track TLS certificate expiry" ticked is looked up once a day.

A Worker's `fetch` does not expose the certificate the server presented, so Lighthouse cannot read it directly. Instead it looks the hostname up in public Certificate Transparency logs (through crt.sh) and takes the most recently issued certificate that covers it and is currently valid, including wildcards. For certificates that renew automatically this matches what is served. The thresholds for TLS are deliberately short (five days urgent, fourteen days worth a mention) because automatic renewal normally happens around thirty days out. Set the variable `TLS_SOURCE` to `off` to disable the lookup.

### Supabase

1. In the Supabase dashboard, open your account settings, then Access Tokens, and generate a token.
2. Set it:

   ```sh
   npx wrangler secret put SUPABASE_ACCESS_TOKEN
   ```

Every project the token can see is listed with its status. Active projects also get a health check of the database, auth, REST and storage services. To show database size, set the variable `SUPABASE_DB_SIZE` to `true`; Lighthouse then runs one read-only query per project (`select pg_database_size(current_database())`) through the Management API.

### Manual reminders and releases

Use the Expiries page for anything with a date that no API reports: domain renewals, the Apple developer agreement, programme membership, Play Console verification deadlines. Reminders can repeat monthly or yearly; marking a repeating reminder as done moves it to its next date. Use the Releases page to plan versions, launches or anything else you want on the calendar.

### Daily digest

The digest is built once a day after `DIGEST_HOUR` in `TIMEZONE` and covers everything since the previous one. Choose a provider with the `DIGEST_PROVIDER` variable:

| Provider | Settings |
| --- | --- |
| `none` | The default. The digest can still be previewed on the Settings page. |
| `log` | Writes the digest to the Worker logs. |
| `webhook` | Secret `DIGEST_WEBHOOK_URL`. Variable `DIGEST_WEBHOOK_FORMAT` is `json` (subject, text, html), `slack` or `discord`. |
| `resend` | Secret `RESEND_API_KEY`. Variables `DIGEST_EMAIL_FROM` (an address on a domain verified with Resend) and `DIGEST_EMAIL_TO` (comma separated). |

Set `DASHBOARD_URL` to include a link back to the dashboard. The Settings page has a preview and a "send a test" button.

### Sign-in

Lighthouse is single-user. There are two ways to protect it.

**Cloudflare Access (recommended).** Create a self-hosted Access application for the Worker's hostname and allow only your own identity. Then set two variables so the Worker checks the Access token itself as well, which protects you if the Worker is ever reachable another way (for example on its `workers.dev` address):

- `ACCESS_TEAM_DOMAIN`: your team name, for example `mystudio` for `mystudio.cloudflareaccess.com`
- `ACCESS_AUD`: the Application Audience (AUD) tag from the Access application's settings

The Worker verifies the token's signature against your team's published keys, and checks the issuer, audience and expiry. It is worth disabling the `workers.dev` route in the Worker's settings too.

**Passphrase.** Set two secrets:

```sh
npx wrangler secret put LIGHTHOUSE_PASSPHRASE
npx wrangler secret put SESSION_SECRET
```

Use a long passphrase, and a random value for the session secret (for example from `openssl rand -base64 32`). Signing in sets an HMAC-signed, HttpOnly, SameSite=Strict cookie valid for thirty days. Changing either secret signs every session out. Failed attempts are slowed down per address, but that limit lives in a single Worker instance, so add a Cloudflare rate limiting rule for `/api/login` if the dashboard is on the open internet.

If neither is configured, the API refuses every request (the health check aside). The only exception is demo mode, which is open because it only ever shows invented data.

## Deploying

These are the steps; nothing in this repository deploys automatically.

1. Log in: `npx wrangler login`.
2. Create the database: `npx wrangler d1 create lighthouse`, and copy the `database_id` it prints into `wrangler.jsonc` in place of the zeros.
3. Apply the migrations: `npm run db:migrate:remote`.
4. Review the `vars` in `wrangler.jsonc`, especially `TIMEZONE` and `DIGEST_HOUR`. Leave `DEMO_MODE` as `"false"`.
5. Set up sign-in (see above) and the secrets for the providers you want.
6. Deploy: `npm run deploy`. This builds the front end and runs `wrangler deploy`.
7. Open the dashboard, add your apps and endpoints, and press "Run collectors now" on the Settings page to check every connection straight away.

The cron trigger runs every five minutes. Each job remembers when it last ran, so uptime runs every tick, reviews and Supabase hourly, store versions every six hours, and expiries and housekeeping daily. A late or missed tick is caught up on the next one.

For a handful of apps and endpoints this should sit well inside Cloudflare's free plan: each endpoint costs a few D1 writes per check. If you watch dozens of endpoints, compare the numbers with the current Workers and D1 limits.

## Settings reference

Variables live in `wrangler.jsonc` under `vars`. Secrets are set with `wrangler secret put`.

| Name | Kind | Default | Purpose |
| --- | --- | --- | --- |
| `DEMO_MODE` | variable | `false` | Use invented data and fake providers |
| `TIMEZONE` | variable | `Europe/London` | Time zone for calendar days and the digest hour |
| `DIGEST_PROVIDER` | variable | `none` | `none`, `log`, `webhook` or `resend` |
| `DIGEST_HOUR` | variable | `8` | Local hour after which the daily digest is sent |
| `DIGEST_WEBHOOK_FORMAT` | variable | `json` | `json`, `slack` or `discord` |
| `DIGEST_EMAIL_FROM`, `DIGEST_EMAIL_TO` | variable | | Addresses for Resend |
| `DASHBOARD_URL` | variable | | Link included in the digest |
| `KEEP_REVIEWER_NAMES` | variable | `false` | Store reviewer nicknames |
| `CHECK_RETENTION_DAYS` | variable | `14` | How long individual uptime checks are kept |
| `TLS_SOURCE` | variable | `crtsh` | Set to `off` to skip TLS lookups |
| `SUPABASE_DB_SIZE` | variable | `false` | Read database size through the Management API |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | variable | | Cloudflare Access verification |
| `LIGHTHOUSE_PASSPHRASE`, `SESSION_SECRET` | secret | | Passphrase sign-in |
| `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY` | secret | | App Store Connect API key |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | secret | | Google service account JSON key |
| `SUPABASE_ACCESS_TOKEN` | secret | | Supabase personal access token |
| `DIGEST_WEBHOOK_URL` | secret | | Webhook for the digest |
| `RESEND_API_KEY` | secret | | Resend API key |

## How it is organised

```
migrations/          D1 schema
src/index.ts         Worker entry: API, static assets and the cron trigger
src/api/             Router, validation and API routes
src/providers/       One adapter per service, each behind an interface, plus demo fakes
src/scheduler.ts     Decides which jobs are due
src/jobs.ts          What each job does
src/incidents.ts     Incident state machine
src/expiry.ts        Days left and how loudly to say so
src/digest/          Digest building and delivery
src/auth.ts          Cloudflare Access and passphrase sign-in
src/db/store.ts      All SQL in one place
web/                 Preact front end
test/                Vitest tests and invented fixtures
```

Every external API sits behind an interface in `src/providers/types.ts`, with a live implementation and a fake. The tests use the fakes and recorded fixtures; the App Store Connect and Google tests generate throwaway keys at run time and verify the signed tokens, so no key material exists in the repository.

## Privacy and security

- Lighthouse watches your own services' health and nothing else. It does not scan, probe or test anything you do not list.
- No credentials are stored in the repository or the database. They live in Worker secrets (or `.dev.vars` locally, which is git-ignored), are only read inside the Worker, and never appear in API responses or the dashboard.
- Reviews are stored with their rating, title, text, territory or language, app version and date. Reviewer names are dropped unless you set `KEEP_REVIEWER_NAMES` to `true`.
- Individual uptime checks are deleted after `CHECK_RETENTION_DAYS`, and the change log behind the digest after sixty days. Incidents are kept.
- The App Store Connect key, Google service account and Supabase token are all more powerful than Lighthouse needs, because those services do not offer narrower read-only credentials for everything here. Lighthouse only ever makes read requests, with one exception: reading Google Play tracks opens a temporary edit, which it deletes again without committing. Give each credential the narrowest role that works and rotate it if you suspect it has leaked.
- The front end is served with a strict Content Security Policy, no third-party scripts, fonts or analytics, and pages are marked not to be indexed. API responses are not cached. Writes must be same-origin JSON requests.
- Review text is shown as text, never as HTML, and is escaped in the HTML digest.
- Demo mode is open without sign-in. Do not deploy with `DEMO_MODE` set to `true` unless you are happy for anyone to see the invented data.

## Limitations

- TLS expiry comes from Certificate Transparency logs, not the live handshake, so it cannot see a certificate that was never logged, and it relies on crt.sh being available. Unusual setups, such as several certificates for the same name on different servers, may show the newest one rather than the one actually served.
- The Google Play reviews API only returns reviews from roughly the last week, and only those with text. Star-only ratings and older reviews are not available, so Lighthouse needs to run at least weekly to avoid gaps.
- App Store Connect does not expose the developer programme agreement or membership renewal through its API, and neither store exposes domain renewals, so those are manual reminders.
- Release dates from App Store Connect are only known when a release is scheduled; live versions and Play releases appear without a date.
- Uptime checks run every five minutes, so an outage shorter than that may not be seen, and with the default threshold an incident opens after about ten minutes.
- Login throttling is per Worker instance. Use Cloudflare Access or a rate limiting rule for real protection.
- It is single-user, English only, and has no alerting other than the daily digest yet. See the roadmap.

## Licence

MIT. See [LICENSE](LICENSE).
