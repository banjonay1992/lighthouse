# Roadmap

Rough estimates are in hours of focused work, including tests and documentation. They add up to a little over sixty hours. The order reflects what would make the dashboard more useful day to day, not what is most interesting to build.

## Next

These close the most obvious gaps in the first version.

- **Immediate incident alerts (3 h).** Today an outage only reaches you through the daily digest. Send a short message through the configured webhook or email provider when an incident opens and when it resolves, with a per-endpoint switch and a quiet-hours setting. The incident state machine already reports open and resolve actions, so this is mostly delivery, rate limiting and tests.
- **Edit reminders, releases and apps in place (2 h).** The API already upserts by id, but the front end can only create and delete. Add edit forms that reuse the existing ones and keep the disclosure pattern.
- **Domain expiry from RDAP (4 h).** Replace manual domain reminders with a lookup through the IANA RDAP bootstrap file, cached in D1 and refreshed weekly. Fall back to the manual reminder when a registry does not publish an expiry date. Fixtures for at least `.com`, `.uk` and `.dev` responses.
- **Cloudflare edge certificates as a TLS source (3 h).** For zones on Cloudflare, read certificate packs through the Cloudflare API with a token scoped to SSL read access. This gives the certificate actually served at the edge, which removes the main caveat of the Certificate Transparency approach for most users.
- **Clearer provider errors on the Settings page (2 h).** Map common failures (expired App Store key, missing Play permission, revoked Supabase token) to a plain explanation and a link to the right console page, instead of showing the raw API message.

## Then

Improvements that make the data richer once the basics are settled.

- **Hourly rollups for uptime (4 h).** Keep raw checks for two days and store hourly aggregates (count, failures, median and 95th percentile latency) for a year, so the 30 day view and longer history do not read thousands of rows. Needs a migration, a rollup job and changes to the endpoint detail view.
- **Review search (3 h).** Full text search over review titles and bodies using SQLite FTS5 in D1, with the search box on the Reviews page and the existing filters still applying.
- **Reply to reviews (5 h).** Post replies through the App Store Connect customer review responses endpoint and the Play reviews reply endpoint, show existing developer responses, and record who replied and when. Needs care with the credential roles and a confirmation step.
- **Worker analytics (5 h).** Requests, error rate and CPU time per Worker from the Cloudflare GraphQL Analytics API, shown alongside uptime for the matching endpoint. Requires an API token with analytics read access and a mapping from endpoints to Worker scripts.
- **Cloudflare Email Routing as a digest provider (2 h).** Use the `send_email` binding so people already on Cloudflare do not need a third-party email service. The binding cannot be imported in Node tests, so it needs a thin wrapper with a fake.
- **More flexible checks (3 h).** Custom request headers and methods for endpoints that need an API key or a POST body, with header values stored as Worker secrets referenced by name rather than in D1.
- **Export and import of configuration (2 h).** Download apps, endpoints, reminders and planned releases as JSON and load them into a fresh install, which also makes moving between accounts painless.

## Later

Worth doing, but not until the above has been used for a while.

- **Ratings over time (4 h).** Store a daily snapshot of average rating and rating count per app and territory, and chart it beside the review list. App Store figures could come from the public lookup endpoint; Play needs a different source and may not be possible without the reporting exports.
- **Optional public status page (6 h).** A read-only page listing chosen endpoints and recent incidents, served from the same Worker on a separate path with its own cache rules, and off by default.
- **Browser end-to-end tests in CI (3 h).** The happy-dom smoke test catches views that crash, but not layout or keyboard problems. Add a small Playwright suite against `wrangler dev` in demo mode.
- **Accessibility pass (3 h).** Check keyboard navigation through the filters and disclosures, focus handling after forms submit, colour contrast in both themes, and screen reader announcements for status changes.
- **Crash and stability figures (8 h).** App Store Connect analytics reports and the Play vitals API both offer crash rates, but through asynchronous report requests with very different shapes. Investigate whether a useful daily figure can be pulled reliably before committing to the full feature.
- **Backup and restore notes (1 h).** Document D1 Time Travel and an `npx wrangler d1 export` routine, and add a script that exports the database to a dated file.
