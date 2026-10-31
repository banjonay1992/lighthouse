-- Lighthouse initial schema.
-- Timestamps are ISO 8601 strings in UTC. Calendar dates are YYYY-MM-DD.

-- Apps you publish. Either store id may be empty if the app is only on one store.
CREATE TABLE apps (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  appstore_id   TEXT,
  play_package  TEXT,
  created_at    TEXT NOT NULL
);

-- Store reviews. The id is "<platform>:<store review id>" so re-fetching is idempotent.
-- Reviewer names are only kept when KEEP_REVIEWER_NAMES is "true".
CREATE TABLE reviews (
  id           TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        TEXT,
  body         TEXT NOT NULL,
  reviewer     TEXT,
  territory    TEXT,
  app_version  TEXT,
  created_at   TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  read_at      TEXT
);
CREATE INDEX reviews_by_app_created ON reviews (app_id, created_at DESC);
CREATE INDEX reviews_by_created ON reviews (created_at DESC);
CREATE INDEX reviews_unread ON reviews (created_at DESC) WHERE read_at IS NULL;

-- HTTP endpoints to watch, plus their current derived state.
CREATE TABLE endpoints (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  url                    TEXT NOT NULL,
  expected_status        INTEGER,
  keyword                TEXT,
  timeout_ms             INTEGER NOT NULL DEFAULT 10000,
  check_tls              INTEGER NOT NULL DEFAULT 1,
  failure_threshold      INTEGER NOT NULL DEFAULT 2,
  recovery_threshold     INTEGER NOT NULL DEFAULT 1,
  status                 TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('up', 'down', 'unknown')),
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  consecutive_successes  INTEGER NOT NULL DEFAULT 0,
  last_checked_at        TEXT,
  last_latency_ms        INTEGER,
  created_at             TEXT NOT NULL
);

-- Individual check results. Pruned after CHECK_RETENTION_DAYS.
CREATE TABLE checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id  TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  checked_at   TEXT NOT NULL,
  ok           INTEGER NOT NULL,
  status_code  INTEGER,
  latency_ms   INTEGER,
  error        TEXT
);
CREATE INDEX checks_by_endpoint_time ON checks (endpoint_id, checked_at DESC);

-- Outages. An incident opens after failure_threshold consecutive failures
-- and resolves after recovery_threshold consecutive successes.
CREATE TABLE incidents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id    TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  started_at     TEXT NOT NULL,
  resolved_at    TEXT,
  cause          TEXT NOT NULL,
  failure_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX incidents_by_started ON incidents (started_at DESC);
CREATE INDEX incidents_open ON incidents (endpoint_id) WHERE resolved_at IS NULL;

-- Expiries discovered automatically (signing certificates, profiles, TLS).
-- The id is a stable key from the source, e.g. "tls:example.com".
CREATE TABLE expiries (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  detail      TEXT,
  updated_at  TEXT NOT NULL
);
CREATE INDEX expiries_by_date ON expiries (expires_at);

-- Manual reminders: domain renewals, the Apple developer agreement, anything else.
CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'other',
  due_on      TEXT NOT NULL,
  repeat      TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'monthly', 'yearly')),
  notes       TEXT,
  created_at  TEXT NOT NULL
);

-- Releases, either entered by hand or pulled from the stores.
CREATE TABLE releases (
  id            TEXT PRIMARY KEY,
  app_id        TEXT REFERENCES apps(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web', 'other')),
  version       TEXT NOT NULL,
  state         TEXT NOT NULL,
  release_date  TEXT,
  source        TEXT NOT NULL CHECK (source IN ('manual', 'appstore', 'googleplay')),
  notes         TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX releases_by_date ON releases (release_date);

-- Latest known state of each Supabase project.
CREATE TABLE supabase_projects (
  ref            TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  region         TEXT,
  status         TEXT NOT NULL,
  healthy        INTEGER,
  services       TEXT,
  db_size_bytes  INTEGER,
  checked_at     TEXT NOT NULL
);

-- When each scheduled job last ran, used to decide what is due.
CREATE TABLE job_runs (
  job          TEXT PRIMARY KEY,
  last_run_at  TEXT NOT NULL,
  last_ok      INTEGER NOT NULL,
  last_error   TEXT
);

-- A small change log that feeds the daily digest.
CREATE TABLE events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  kind     TEXT NOT NULL,
  subject  TEXT NOT NULL,
  detail   TEXT
);
CREATE INDEX events_by_at ON events (at);

-- Digests that have been built and (maybe) delivered.
CREATE TABLE digests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at     TEXT NOT NULL,
  local_date  TEXT NOT NULL,
  provider    TEXT NOT NULL,
  delivered   INTEGER NOT NULL,
  summary     TEXT
);
