// Orchestration for user-authored challenges: validate, enforce id rules, persist,
// and rebuild the live challenge registry so the new/edited/removed challenge shows
// up (or disappears) immediately without a restart.
//
// Every mutating function returns a small discriminated result the route maps onto
// an HTTP status, so all the policy lives here and can be unit-tested without HTTP.

import { validateAuthored, loadAuthored } from '../challenges/authored.js';
import {
  getAllAuthoredRows,
  getAuthoredRow,
  upsertAuthored,
  deleteAuthored,
} from '../db/authoredRepo.js';
import { deleteProgress } from '../db/progressRepo.js';
import { deleteReview } from '../db/reviewsRepo.js';

/** Re-read all authored rows and swap them into the registry's merged store. */
function refresh(db, registry, log) {
  registry.rebuild(loadAuthored(db, log));
}

/**
 * Metadata for every authored challenge, for the management list. Corrupt rows are
 * tolerated (shown with whatever we can parse) so the user can still delete them.
 * @param {import('better-sqlite3').Database} db
 */
export function listAuthored(db) {
  return getAllAuthoredRows(db).map((row) => {
    let data = {};
    try {
      data = JSON.parse(row.data);
    } catch {
      /* leave data empty; the row is still listable/deletable */
    }
    return {
      id: row.id,
      title: data.title ?? row.id,
      topic: data.topic ?? '',
      difficulty: data.difficulty ?? 1,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * The full stored challenge (all fields, including tests + solution) for the editor.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object | null}
 */
export function getAuthoredFull(db, id) {
  const row = getAuthoredRow(db, id);
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Create a new authored challenge.
 * @returns {{ ok: true, challenge: object }
 *          | { ok: false, status: number, error: string, details?: string[] }}
 */
export function createAuthored(db, registry, input, log) {
  const result = validateAuthored(input);
  if (!result.ok) {
    return { ok: false, status: 400, error: 'Challenge is invalid', details: result.errors };
  }
  const { challenge } = result;

  if (registry.seedIds().has(challenge.id)) {
    return { ok: false, status: 409, error: `"${challenge.id}" is a built-in challenge id.` };
  }
  if (getAuthoredRow(db, challenge.id)) {
    return { ok: false, status: 409, error: `A challenge with id "${challenge.id}" already exists.` };
  }

  upsertAuthored(db, challenge.id, JSON.stringify(challenge));
  refresh(db, registry, log);
  return { ok: true, challenge };
}

/**
 * Update an existing authored challenge. The path id is authoritative: a differing
 * `id` in the body is overwritten, never honoured, so we can't accidentally
 * delete+recreate the row and orphan its progress/review state.
 * @returns {{ ok: true, challenge: object }
 *          | { ok: false, status: number, error: string, details?: string[] }}
 */
export function updateAuthored(db, registry, id, input, log) {
  if (!getAuthoredRow(db, id)) {
    return { ok: false, status: 404, error: 'Authored challenge not found' };
  }
  // Pin the id to the path before validating so the stored key can never drift.
  const result = validateAuthored({ ...input, id });
  if (!result.ok) {
    return { ok: false, status: 400, error: 'Challenge is invalid', details: result.errors };
  }
  upsertAuthored(db, id, JSON.stringify(result.challenge));
  refresh(db, registry, log);
  return { ok: true, challenge: result.challenge };
}

/**
 * Delete an authored challenge and all of its per-challenge state (progress + review
 * schedule), so nothing dangling can skew the dashboard or resurface for review.
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function removeAuthored(db, registry, id, log) {
  if (!deleteAuthored(db, id)) {
    return { ok: false, status: 404, error: 'Authored challenge not found' };
  }
  deleteProgress(db, id);
  deleteReview(db, id);
  refresh(db, registry, log);
  return { ok: true };
}
