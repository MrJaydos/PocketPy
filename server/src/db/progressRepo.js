// All the SQL for reading and writing the user's per-challenge progress lives here,
// so routes deal in plain function calls instead of raw SQL. Each function takes
// the db handle as its first argument, which keeps them easy to unit-test against
// a throwaway in-memory database.

/** ISO timestamp for "now", so callers don't repeat `new Date().toISOString()`. */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Fetch the progress row for one challenge, or undefined if untouched.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 */
export function getProgress(db, challengeId) {
  return db.prepare('SELECT * FROM progress WHERE challenge_id = ?').get(challengeId);
}

/**
 * Fetch every progress row keyed by challenge id (for merging status into lists).
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, any>}
 */
export function getAllProgress(db) {
  const rows = db.prepare('SELECT * FROM progress').all();
  return new Map(rows.map((r) => [r.challenge_id, r]));
}

/**
 * Ensure a progress row exists for a challenge, returning it. Used before any
 * update so we never have to special-case "first interaction".
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 */
export function ensureRow(db, challengeId) {
  const existing = getProgress(db, challengeId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO progress (challenge_id, status, updated_at) VALUES (?, 'attempted', ?)`,
  ).run(challengeId, nowIso());
  return getProgress(db, challengeId);
}

/**
 * Record a submission attempt: increments the attempt counter and stamps the
 * first-attempt time once.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 */
export function recordAttempt(db, challengeId) {
  ensureRow(db, challengeId);
  const now = nowIso();
  db.prepare(
    `UPDATE progress
       SET attempts = attempts + 1,
           first_attempt_at = COALESCE(first_attempt_at, ?),
           updated_at = ?
     WHERE challenge_id = ?`,
  ).run(now, now, challengeId);
  return getProgress(db, challengeId);
}

/**
 * Mark a challenge solved. Idempotent: solving an already-solved challenge does not
 * move `solved_at`. Returns whether this call was the *first* solve (the caller
 * uses that to decide whether to record a solve-day for the streak).
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 * @returns {{firstSolve: boolean}}
 */
export function markSolved(db, challengeId) {
  const row = ensureRow(db, challengeId);
  const firstSolve = row.status !== 'solved';
  const now = nowIso();
  db.prepare(
    `UPDATE progress
       SET status = 'solved',
           solved_at = COALESCE(solved_at, ?),
           updated_at = ?
     WHERE challenge_id = ?`,
  ).run(now, now, challengeId);
  return { firstSolve };
}

/**
 * Increment the hints-used counter to at least `revealedCount`. We store the max
 * revealed rather than a raw increment so re-revealing the same hint isn't
 * double-counted.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 * @param {number} revealedCount  How many hints are now revealed (index + 1).
 */
export function recordHintUsed(db, challengeId, revealedCount) {
  ensureRow(db, challengeId);
  db.prepare(
    `UPDATE progress
       SET hints_used = MAX(hints_used, ?),
           updated_at = ?
     WHERE challenge_id = ?`,
  ).run(revealedCount, nowIso(), challengeId);
}

/**
 * Mark the reference solution as revealed.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 */
export function markSolutionViewed(db, challengeId) {
  ensureRow(db, challengeId);
  db.prepare(
    `UPDATE progress SET solution_viewed = 1, updated_at = ? WHERE challenge_id = ?`,
  ).run(nowIso(), challengeId);
}

/**
 * Save the autosaved draft code for a challenge.
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 * @param {string} code
 */
export function saveDraft(db, challengeId, code) {
  ensureRow(db, challengeId);
  db.prepare(
    `UPDATE progress SET draft_code = ?, updated_at = ? WHERE challenge_id = ?`,
  ).run(code, nowIso(), challengeId);
}

/**
 * Record that the user solved *something* on the given calendar day (YYYY-MM-DD).
 * Inserting an existing day is a no-op, so the streak set stays clean.
 * @param {import('better-sqlite3').Database} db
 * @param {string} day
 */
export function recordSolveDay(db, day) {
  db.prepare('INSERT INTO solve_days (day) VALUES (?) ON CONFLICT(day) DO NOTHING').run(day);
}

/**
 * All solve-days as an array of 'YYYY-MM-DD' strings, ascending.
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]}
 */
export function getSolveDays(db) {
  return db.prepare('SELECT day FROM solve_days ORDER BY day ASC').all().map((r) => r.day);
}

/** Read a scalar from the meta table. */
export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
}

/** Write a scalar to the meta table. */
export function setMeta(db, key, value) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}
