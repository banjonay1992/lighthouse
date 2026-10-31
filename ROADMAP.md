# Roadmap

Rough estimates are in hours of focused work, including tests and documentation. They add up to a little under seventy hours. The order reflects what would make the dashboard more useful day to day, not what is most interesting to build.

Every item has a GitHub issue with acceptance criteria, grouped into the [v0.2](https://github.com/banjonay1992/lighthouse/milestone/1), [v0.3](https://github.com/banjonay1992/lighthouse/milestone/2) and [Later](https://github.com/banjonay1992/lighthouse/milestone/3) milestones. The [`roadmap` label](https://github.com/banjonay1992/lighthouse/labels/roadmap) lists them all.

## Next

These close the most obvious gaps in the first version (milestone v0.2).

- **Verify the store adapters against live accounts (3 h).** The App Store Connect and Google Play adapters follow the published API documentation and are tested against invented fixtures, but have not yet been run against a real team key or service account. Run every call for real, fix any differences, and record the roles that worked. ([#1](https://github.com/banjonay1992/lighthouse/issues/1))
- **Deploy the public demo (1 h).** Connect a `lighthouse-demo` Worker to this repository with Workers Builds, as described in the README, and link it from the top of the README. ([#2](https://github.com/banjonay1992/lighthouse/issues/2))
- **Immediate incident alerts (3 h).** Today an outage only reaches you through the daily digest. Send a short message through the configured webhook or email provider when an incident opens and when it resolves, with a per-endpoint switch and a quiet-hours setting. The incident state machine already reports open and resolve actions, so this is mostly delivery, rate limiting and tests. ([#3](https://github.com/banjonay1992/lighthouse/issues/3))
- **Edit reminders, releases and apps in place (2 h).** The API already upserts by id, but the front end can only create and delete. Add edit forms that reuse the existing ones and keep the disclosure pattern. ([#4](https://github.com/banjonay1992/lighthouse/issues/4))
- **Domain expiry from RDAP (4 h).** Replace manual domain reminders with a lookup through the IANA RDAP bootstrap file, cached in D1 and refreshed weekly. Fall back to the manual reminder when a registry does not publish an expiry date. Fixtures for at least `.com`, `.uk` and `.dev` responses. ([#5](https://github.com/banjonay1992/lighthouse/issues/5))
- **Cloudflare edge certificates as a TLS source (3 h).** For zones on Cloudflare, read certificate packs through the Cloudflare API with a token scoped to SSL read access. This gives the certificate actually served at the edge, which removes the main caveat of the Certificate Transparency approach for most users. ([#6](https://github.com/banjonay1992/lighthouse/issues/6))
- **Clearer provider errors on the Settings page (2 h).** Map common failures (expired App Store key, missing Play permission, revoked Supabase token) to a plain explanation and a link to the right console page, instead of showing the raw API message. ([#7](https://github.com/banjonay1992/lighthouse/issues/7))

## Then

Improvements that make the data richer once the basics are settled (milestone v0.3).

- **Hourly rollups for uptime (4 h).** Keep raw checks for two days and store hourly aggregates (count, failures, median and 95th percentile latency) for a year, so the 30 day view and longer history do not read thousands of rows. Needs a migration, a rollup job and changes to the endpoint detail view. ([#8](https://github.com/banjonay1992/lighthouse/issues/8))
- **Review search (3 h).** Full text search over review titles and bodies using SQLite FTS5 in D1, with the search box on the Reviews page and the existing filters still applying. ([#9](https://github.com/banjonay1992/lighthouse/issues/9))
- **Reply to reviews (5 h).** Post replies through the App Store Connect customer review responses endpoint and the Play reviews reply endpoint, show existing developer responses, and record who replied and when. Needs care with the credential roles and a confirmation step. ([#10](https://github.com/banjonay1992/lighthouse/issues/10))
- **Worker analytics (5 h).** Requests, error rate and CPU time per Worker from the Cloudflare GraphQL Analytics API, shown alongside uptime for the matching endpoint. Requires an API token with analytics read access and a mapping from endpoints to Worker scripts. ([#11](https://github.com/banjonay1992/lighthouse/issues/11))
- **Cloudflare Email Routing as a digest provider (2 h).** Use the `send_email` binding so people already on Cloudflare do not need a third-party email service. The binding cannot be imported in Node tests, so it needs a thin wrapper with a fake. ([#12](https://github.com/banjonay1992/lighthouse/issues/12))
- **More flexible checks (3 h).** Custom request headers and methods for endpoints that need an API key or a POST body, with header values stored as Worker secrets referenced by name rather than in D1. ([#13](https://github.com/banjonay1992/lighthouse/issues/13))
- **Export and import of configuration (2 h).** Download apps, endpoints, reminders and planned releases as JSON and load them into a fresh install, which also makes moving between accounts painless. ([#14](https://github.com/banjonay1992/lighthouse/issues/14))

## Later

Worth doing, but not until the above has been used for a while (milestone Later).

- **Ratings over time (4 h).** Store a daily snapshot of average rating and rating count per app and territory, and chart it beside the review list. App Store figures could come from the public lookup endpoint; Play needs a different source and may not be possible without the reporting exports. ([#15](https://github.com/banjonay1992/lighthouse/issues/15))
- **Optional public status page (6 h).** A read-only page listing chosen endpoints and recent incidents, served from the same Worker on a separate path with its own cache rules, and off by default. ([#16](https://github.com/banjonay1992/lighthouse/issues/16))
- **Browser end-to-end tests in CI (3 h).** The happy-dom smoke test catches views that crash, but not layout or keyboard problems. Add a small Playwright suite against `wrangler dev` in demo mode. ([#17](https://github.com/banjonay1992/lighthouse/issues/17))
- **Accessibility pass (3 h).** Check keyboard navigation through the filters and disclosures, focus handling after forms submit, colour contrast in both themes, and screen reader announcements for status changes. ([#18](https://github.com/banjonay1992/lighthouse/issues/18))
- **Crash and stability figures (8 h).** App Store Connect analytics reports and the Play vitals API both offer crash rates, but through asynchronous report requests with very different shapes. Investigate whether a useful daily figure can be pulled reliably before committing to the full feature. ([#19](https://github.com/banjonay1992/lighthouse/issues/19))
- **Backup and restore notes (1 h).** Document D1 Time Travel and an `npx wrangler d1 export` routine, and add a script that exports the database to a dated file. ([#20](https://github.com/banjonay1992/lighthouse/issues/20))
