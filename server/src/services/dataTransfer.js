// Import/export of the user's entire dataset as a single versioned JSON envelope.
//
// The envelope is the union of everything persistent: challenge progress, streak
// solve-days, the spaced-repetition schedule, and any authored challenges. It carries
// a `version` so a future format change is a branch here, not a silent
// misinterpretation of an old file. Export builds it; import validates the version and
// shape, re-checks authored challenges against the schema, and applies it atomically.

import { exportRows, importRows } from '../db/dataRepo.js';
import { validateAuthored } from '../challenges/authored.js';

/** Bump only when the envelope shape changes in a non-backward-compatible way. */
export const EXPORT_VERSION = 1;

/**
 * Build the export envelope from the current database.
 * @param {import('better-sqlite3').Database} db
 */
export function exportData(db) {
  const rows = exportRows(db);
  return {
    app: 'pypocket',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    progress: rows.progress,
    solveDays: rows.solveDays,
    reviews: rows.reviews,
    // Parse each authored challenge's JSON so the export is human-readable rather
    // than a string-in-a-string; import re-serializes it.
    authoredChallenges: rows.authored.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      challenge: safeParse(r.data),
    })),
    meta: rows.meta,
  };
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** True for a plain object (not null, not an array). */
function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Validate and apply an import envelope.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} envelope  Parsed JSON from the uploaded file.
 * @param {'replace' | 'merge'} [mode]  'merge' (default) upserts; 'replace' wipes first.
 * @returns {{ ok: true, mode: string, summary: object }
 *          | {  ok: false, status: number, error: string }}
 */
export function importData(db, envelope, mode = 'merge') {
  if (!isObject(envelope)) {
    return { ok: false, status: 400, error: 'That file is not a PyPocket export.' };
  }
  if (envelope.version !== EXPORT_VERSION) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported export version ${envelope.version ?? '(none)'}; this app reads version ${EXPORT_VERSION}.`,
    };
  }
  if (mode !== 'replace' && mode !== 'merge') {
    return { ok: false, status: 400, error: "mode must be 'merge' or 'replace'." };
  }

  // Progress + reviews: keep only rows with the keys the tables require.
  const progress = asArray(envelope.progress).filter((r) => isObject(r) && typeof r.challenge_id === 'string');
  const reviews = asArray(envelope.reviews).filter(
    (r) => isObject(r) && typeof r.challenge_id === 'string' && typeof r.due_day === 'string',
  );
  const solveDays = asArray(envelope.solveDays).filter((d) => typeof d === 'string');
  const meta = asArray(envelope.meta).filter((m) => isObject(m) && typeof m.key === 'string');

  // Authored challenges are re-validated against the live schema; anything that
  // doesn't pass is skipped rather than trusted (the file may be old or hand-edited).
  const authored = [];
  let skippedAuthored = 0;
  for (const item of asArray(envelope.authoredChallenges)) {
    if (!isObject(item) || !isObject(item.challenge)) {
      skippedAuthored += 1;
      continue;
    }
    const result = validateAuthored(item.challenge);
    if (!result.ok || result.challenge.id !== item.id) {
      skippedAuthored += 1;
      continue;
    }
    authored.push({
      id: result.challenge.id,
      dataJson: JSON.stringify(result.challenge),
      created_at: typeof item.created_at === 'string' ? item.created_at : undefined,
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : undefined,
    });
  }

  importRows(db, { progress, solveDays, reviews, authored, meta }, mode);

  return {
    ok: true,
    mode,
    summary: {
      progress: progress.length,
      solveDays: solveDays.length,
      reviews: reviews.length,
      authoredChallenges: authored.length,
      skippedAuthored,
    },
  };
}
