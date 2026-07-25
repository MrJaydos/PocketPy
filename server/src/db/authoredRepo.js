// SQL for user-authored challenges (the `authored_challenges` table). The stored
// `data` column is a JSON string conforming to challengeSchema; parsing/validation
// lives in challenges/authored.js, so this layer only moves rows in and out.

/** ISO timestamp for "now". */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Every authored row, oldest first. Rows are `{ id, data, created_at, updated_at }`
 * where `data` is still a JSON string.
 * @param {import('better-sqlite3').Database} db
 */
export function getAllAuthoredRows(db) {
  return db.prepare('SELECT * FROM authored_challenges ORDER BY created_at ASC').all();
}

/**
 * One authored row by id, or undefined.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function getAuthoredRow(db, id) {
  return db.prepare('SELECT * FROM authored_challenges WHERE id = ?').get(id);
}

/**
 * Insert or replace an authored challenge, preserving created_at across updates.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {string} dataJson  JSON string of the validated challenge.
 */
export function upsertAuthored(db, id, dataJson) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO authored_challenges (id, data, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(id, dataJson, now, now);
  return getAuthoredRow(db, id);
}

/**
 * Delete an authored challenge. Returns true if a row was removed.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function deleteAuthored(db, id) {
  const info = db.prepare('DELETE FROM authored_challenges WHERE id = ?').run(id);
  return info.changes > 0;
}
