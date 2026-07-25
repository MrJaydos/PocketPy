-- PyPocket database schema.
--
-- This app is single-user, and the *content* of challenges lives in YAML files in
-- the repo (not the database). So the only things stored here are the user's
-- dynamic state: their progress on each challenge, which days they solved
-- something (for streaks), and a little key/value metadata.
--
-- Every statement is idempotent (IF NOT EXISTS) so migrate.js can safely run it on
-- every boot.

-- One row per challenge the user has interacted with. The primary key is the
-- challenge's stable `id` from its YAML file.
CREATE TABLE IF NOT EXISTS progress (
  challenge_id      TEXT PRIMARY KEY,
  -- 'attempted' once they submit at least once; 'solved' once all tests pass.
  status            TEXT NOT NULL DEFAULT 'attempted',
  attempts          INTEGER NOT NULL DEFAULT 0,
  hints_used        INTEGER NOT NULL DEFAULT 0,
  -- 0/1 boolean: whether the reference solution has been revealed.
  solution_viewed   INTEGER NOT NULL DEFAULT 0,
  first_attempt_at  TEXT,          -- ISO 8601 timestamp
  solved_at         TEXT,          -- ISO 8601 timestamp
  updated_at        TEXT NOT NULL, -- ISO 8601 timestamp
  -- Autosaved draft of the user's code so it survives a browser cache clear.
  draft_code        TEXT
);

-- The source of truth for streaks: one row per calendar day (in APP_TZ) on which
-- the user solved at least one challenge. Streak lengths are computed from this
-- set, so we never have to store a fragile "current streak" counter.
CREATE TABLE IF NOT EXISTS solve_days (
  day TEXT PRIMARY KEY  -- 'YYYY-MM-DD'
);

-- Small key/value store for things like the schema version and cached longest
-- streak. Kept generic so we don't need a migration to stash a new scalar.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Spaced-repetition schedule: one row per solved challenge that has been queued for
-- review. We store an SM-2-style triple (ease/interval/reps) plus the next due day,
-- and recompute the schedule each time the user grades a review. A challenge lands
-- here automatically the first time it's solved. Rows may outlive their challenge
-- (e.g. an authored challenge is deleted), so nothing joins to this by foreign key;
-- the read side simply skips ids the challenge store no longer knows.
CREATE TABLE IF NOT EXISTS reviews (
  challenge_id     TEXT PRIMARY KEY,
  -- SM-2 ease factor; starts at 2.5 and drifts within [1.3, ~2.7].
  ease             REAL    NOT NULL DEFAULT 2.5,
  -- Days until the next review after the most recent grade.
  interval_days    INTEGER NOT NULL DEFAULT 0,
  -- How many successful reviews in a row (resets to 0 on a failed recall).
  reps             INTEGER NOT NULL DEFAULT 0,
  due_day          TEXT    NOT NULL, -- 'YYYY-MM-DD' in APP_TZ
  last_reviewed_at TEXT,             -- ISO 8601 timestamp, null until first graded
  updated_at       TEXT    NOT NULL  -- ISO 8601 timestamp
);
