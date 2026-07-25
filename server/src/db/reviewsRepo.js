// SQL for the spaced-repetition schedule (the `reviews` table). Like progressRepo,
// every function takes the db handle first so they're trivial to unit-test against a
// throwaway in-memory database, and the routes deal in function calls not raw SQL.

/** ISO timestamp for "now". */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Fetch the review row for one challenge, or undefined if it's not scheduled.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 */
export function getReview(db, challengeId) {
  return db.prepare('SELECT * FROM reviews WHERE challenge_id = ?').get(challengeId);
}

/**
 * Every review row (used by export and the dashboard counts).
 * @param {import('better-sqlite3').Database} db
 */
export function getAllReviews(db) {
  return db.prepare('SELECT * FROM reviews ORDER BY due_day ASC, challenge_id ASC').all();
}

/**
 * Reviews due on or before `today`, soonest first — the raw review queue. The caller
 * is responsible for dropping ids the challenge store no longer knows about.
 * @param {import('better-sqlite3').Database} db
 * @param {string} today  'YYYY-MM-DD'
 */
export function getDueReviews(db, today) {
  return db
    .prepare('SELECT * FROM reviews WHERE due_day <= ? ORDER BY due_day ASC, challenge_id ASC')
    .all(today);
}

/**
 * Insert a review only if one doesn't already exist, seeding it from `sched`. Used
 * when a challenge is first solved so it enters the review rotation automatically;
 * an already-scheduled challenge is left untouched.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 * @param {{ease: number, interval_days: number, reps: number, due_day: string}} sched
 */
export function ensureReview(db, challengeId, sched) {
  db.prepare(
    `INSERT INTO reviews (challenge_id, ease, interval_days, reps, due_day, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(challenge_id) DO NOTHING`,
  ).run(challengeId, sched.ease, sched.interval_days, sched.reps, sched.due_day, nowIso());
  return getReview(db, challengeId);
}

/**
 * Overwrite a challenge's schedule after it's been graded, stamping the review time.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 * @param {{ease: number, interval_days: number, reps: number, due_day: string}} sched
 */
export function saveReview(db, challengeId, sched) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO reviews (challenge_id, ease, interval_days, reps, due_day, last_reviewed_at, updated_at)
     VALUES (@id, @ease, @interval, @reps, @due, @now, @now)
     ON CONFLICT(challenge_id) DO UPDATE SET
       ease = excluded.ease,
       interval_days = excluded.interval_days,
       reps = excluded.reps,
       due_day = excluded.due_day,
       last_reviewed_at = excluded.last_reviewed_at,
       updated_at = excluded.updated_at`,
  ).run({
    id: challengeId,
    ease: sched.ease,
    interval: sched.interval_days,
    reps: sched.reps,
    due: sched.due_day,
    now,
  });
  return getReview(db, challengeId);
}

/**
 * Remove a challenge's review row. Used by import-replace and when tidying up a
 * deleted authored challenge.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 */
export function deleteReview(db, challengeId) {
  db.prepare('DELETE FROM reviews WHERE challenge_id = ?').run(challengeId);
}
