// Bulk read/write of every table for import/export. Kept together (and out of the
// service) so all the raw SQL for "the user's entire dataset" lives in one place.
//
// The insert helpers write columns *verbatim* — preserving timestamps like a review's
// due_day or an authored challenge's created_at — unlike the normal repo upserts,
// which stamp "now". That's the whole point of a restore: the data comes back exactly
// as it left.

/** Read every row of every user table. Timestamps/values are returned as-is. */
export function exportRows(db) {
  return {
    progress: db.prepare('SELECT * FROM progress').all(),
    solveDays: db.prepare('SELECT day FROM solve_days ORDER BY day ASC').all().map((r) => r.day),
    reviews: db.prepare('SELECT * FROM reviews').all(),
    authored: db.prepare('SELECT * FROM authored_challenges').all(),
    meta: db.prepare('SELECT key, value FROM meta').all(),
  };
}

/** Insert-or-replace one progress row, tolerating missing optional fields. */
function putProgress(db, r) {
  db.prepare(
    `INSERT INTO progress
       (challenge_id, status, attempts, hints_used, solution_viewed,
        first_attempt_at, solved_at, updated_at, draft_code)
     VALUES (@challenge_id, @status, @attempts, @hints_used, @solution_viewed,
             @first_attempt_at, @solved_at, @updated_at, @draft_code)
     ON CONFLICT(challenge_id) DO UPDATE SET
       status = excluded.status, attempts = excluded.attempts,
       hints_used = excluded.hints_used, solution_viewed = excluded.solution_viewed,
       first_attempt_at = excluded.first_attempt_at, solved_at = excluded.solved_at,
       updated_at = excluded.updated_at, draft_code = excluded.draft_code`,
  ).run({
    challenge_id: r.challenge_id,
    status: r.status ?? 'attempted',
    attempts: r.attempts ?? 0,
    hints_used: r.hints_used ?? 0,
    solution_viewed: r.solution_viewed ?? 0,
    first_attempt_at: r.first_attempt_at ?? null,
    solved_at: r.solved_at ?? null,
    updated_at: r.updated_at ?? new Date().toISOString(),
    draft_code: r.draft_code ?? null,
  });
}

/** Insert-or-replace one review row verbatim (preserving its schedule). */
function putReview(db, r) {
  db.prepare(
    `INSERT INTO reviews
       (challenge_id, ease, interval_days, reps, due_day, last_reviewed_at, updated_at)
     VALUES (@challenge_id, @ease, @interval_days, @reps, @due_day, @last_reviewed_at, @updated_at)
     ON CONFLICT(challenge_id) DO UPDATE SET
       ease = excluded.ease, interval_days = excluded.interval_days, reps = excluded.reps,
       due_day = excluded.due_day, last_reviewed_at = excluded.last_reviewed_at,
       updated_at = excluded.updated_at`,
  ).run({
    challenge_id: r.challenge_id,
    ease: r.ease ?? 2.5,
    interval_days: r.interval_days ?? 0,
    reps: r.reps ?? 0,
    due_day: r.due_day,
    last_reviewed_at: r.last_reviewed_at ?? null,
    updated_at: r.updated_at ?? new Date().toISOString(),
  });
}

/** Insert-or-replace one authored-challenge row verbatim (preserving created_at). */
function putAuthored(db, id, dataJson, createdAt, updatedAt) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO authored_challenges (id, data, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(id, dataJson, createdAt ?? now, updatedAt ?? now);
}

/** Union one solve-day into the set (no-op if already present). */
function putSolveDay(db, day) {
  db.prepare('INSERT INTO solve_days (day) VALUES (?) ON CONFLICT(day) DO NOTHING').run(day);
}

/** Write a meta scalar, except schema_version which the migration owns. */
function putMeta(db, key, value) {
  if (key === 'schema_version') return;
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}

/**
 * Apply a normalized dataset to the database in a single transaction. In 'replace'
 * mode the user tables are wiped first (a clean restore); in 'merge' mode incoming
 * rows are upserted on top of what's already there. Either way the write is atomic —
 * a failure part-way rolls the whole thing back.
 *
 * `data.authored` items are `{ id, dataJson, created_at, updated_at }` (already
 * validated + re-serialized by the service).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{progress: any[], solveDays: string[], reviews: any[],
 *          authored: {id:string,dataJson:string,created_at?:string,updated_at?:string}[],
 *          meta: {key:string,value:any}[]}} data
 * @param {'replace' | 'merge'} mode
 */
export function importRows(db, data, mode) {
  const apply = db.transaction(() => {
    if (mode === 'replace') {
      db.exec('DELETE FROM progress; DELETE FROM solve_days; DELETE FROM reviews; DELETE FROM authored_challenges;');
    }
    for (const r of data.progress) putProgress(db, r);
    for (const day of data.solveDays) putSolveDay(db, day);
    for (const r of data.reviews) putReview(db, r);
    for (const a of data.authored) putAuthored(db, a.id, a.dataJson, a.created_at, a.updated_at);
    for (const m of data.meta) putMeta(db, m.key, m.value);
  });
  apply();
}
