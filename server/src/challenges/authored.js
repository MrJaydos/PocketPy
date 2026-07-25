// Validation and loading for user-authored challenges.
//
// Authored challenges reuse the exact same challengeSchema as the repo's YAML files,
// so an in-app challenge is indistinguishable from a hand-written one once loaded.
// The crucial difference is the *failure policy*: the YAML loader aborts boot on a
// bad file (correct — the developer controls those), whereas a bad row here must
// never brick startup. So loadAuthored validates and skips-with-log; only the
// write path (validateAuthored) surfaces errors, back to the user editing the form.

import { challengeSchema } from './schema.js';
import { getAllAuthoredRows } from '../db/authoredRepo.js';

/**
 * Validate a candidate authored challenge (e.g. from the editor form).
 *
 * Beyond the shared schema we enforce one authoring-specific rule: authored
 * challenges must run in the browser (`runner: "pyodide"`). Server-run challenges
 * need the sandboxed runner container and ship hidden tests, which is out of scope
 * for in-app authoring.
 *
 * @param {unknown} input
 * @returns {{ ok: true, challenge: import('./schema.js').Challenge }
 *          | { ok: false, errors: string[] }}
 */
export function validateAuthored(input) {
  const parsed = challengeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }
  if (parsed.data.runner !== 'pyodide') {
    return { ok: false, errors: ['runner: authored challenges must run in the browser (pyodide)'] };
  }
  return { ok: true, challenge: parsed.data };
}

/**
 * Read every authored challenge from the database, returning the valid ones. Invalid
 * or corrupt rows are logged and skipped, never thrown — a bad row can't stop the
 * server from booting.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ warn: Function }} [log]  A logger (fastify.log); defaults to console.
 * @returns {import('./schema.js').Challenge[]}
 */
export function loadAuthored(db, log = console) {
  const out = [];
  for (const row of getAllAuthoredRows(db)) {
    let raw;
    try {
      raw = JSON.parse(row.data);
    } catch {
      log.warn(`Skipping authored challenge "${row.id}": stored data is not valid JSON.`);
      continue;
    }
    const result = validateAuthored(raw);
    if (!result.ok) {
      log.warn(`Skipping authored challenge "${row.id}": ${result.errors.join('; ')}`);
      continue;
    }
    // Trust the row's primary key over whatever id is embedded in the JSON.
    if (result.challenge.id !== row.id) {
      log.warn(`Skipping authored challenge "${row.id}": id in data ("${result.challenge.id}") does not match.`);
      continue;
    }
    out.push(result.challenge);
  }
  return out;
}
