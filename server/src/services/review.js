// Spaced-repetition scheduling.
//
// Like the streak math in progress.js, the tricky part here is a *pure* function:
// given a challenge's previous SM-2 state and how well the user just recalled it,
// return the next state (ease / interval / reps / due day). No database, no clock —
// so the schedule can be unit-tested with plain objects.
//
// This is a small, deliberately simplified SM-2. The user grades a review with one
// of three buttons, which map onto SM-2 quality scores:
//   - 'again' → failed recall: reset the streak, review again tomorrow.
//   - 'good'  → solid recall: advance on the standard 1 → 6 → interval×ease ladder.
//   - 'easy'  → effortless recall: same ladder but nudge the ease factor up.

import { addDays, dayInTz } from './dates.js';
import { getReview, getDueReviews, saveReview, ensureReview } from '../db/reviewsRepo.js';
import { getMeta, setMeta } from '../db/progressRepo.js';

/** SM-2 quality score (0–5) for each grade button. Below 3 counts as a lapse. */
const QUALITY = { again: 2, good: 4, easy: 5 };

/** Ease never drops below this, or intervals would collapse toward daily forever. */
const MIN_EASE = 1.3;

/** The default state for a challenge that has never been reviewed. */
export const INITIAL_EASE = 2.5;

/**
 * Compute the next review state from the previous one and a grade.
 *
 * @param {{ease: number, interval_days: number, reps: number}} prev  Prior schedule.
 * @param {'again'|'good'|'easy'} grade
 * @param {string} today  'YYYY-MM-DD' in APP_TZ — the day the review happened.
 * @returns {{ease: number, interval_days: number, reps: number, due_day: string}}
 */
export function schedule(prev, grade, today) {
  const q = QUALITY[grade];
  if (q === undefined) {
    throw new Error(`Unknown review grade "${grade}"`);
  }

  const prevEase = Number(prev?.ease) || INITIAL_EASE;
  const prevReps = Number(prev?.reps) || 0;
  const prevInterval = Number(prev?.interval_days) || 0;

  // A lapse: don't touch the (already-earned) ease much, but restart the ladder and
  // bring the card back tomorrow so it's re-drilled soon.
  if (q < 3) {
    return {
      ease: Math.max(MIN_EASE, prevEase - 0.2),
      interval_days: 1,
      reps: 0,
      due_day: addDays(today, 1),
    };
  }

  // Standard SM-2 ease update. For 'good' (q=4) the delta is ~0 (ease holds); for
  // 'easy' (q=5) it's +0.1 (ease grows, so future intervals stretch out faster).
  const ease = Math.max(MIN_EASE, prevEase + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  const reps = prevReps + 1;
  let interval;
  if (reps === 1) interval = 1;
  else if (reps === 2) interval = 6;
  else interval = Math.max(1, Math.round(prevInterval * ease));

  return { ease, interval_days: interval, reps, due_day: addDays(today, interval) };
}

/**
 * The schedule for a challenge's *first* solve, before it's ever been graded. We
 * seed it as a successful first rep so it surfaces for review a day later.
 * @param {string} today  'YYYY-MM-DD' in APP_TZ.
 */
export function initialSchedule(today) {
  return schedule({ ease: INITIAL_EASE, interval_days: 0, reps: 0 }, 'good', today);
}

// --- Orchestration (these touch the db + challenge store) ----------------------

/**
 * The due-for-review queue: every scheduled review whose day has arrived, enriched
 * with challenge metadata for the list screen. Reviews whose challenge the store no
 * longer knows (e.g. a deleted authored challenge) are silently skipped, so a stale
 * schedule row can never surface a broken link.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../challenges/loader.js').ChallengeStore} store
 * @param {string} timeZone
 * @param {() => Date} [clock]
 */
export function buildReviewQueue(db, store, timeZone, clock = () => new Date()) {
  const today = dayInTz(clock(), timeZone);
  const due = [];
  for (const row of getDueReviews(db, today)) {
    const ch = store.get(row.challenge_id);
    if (!ch) continue; // dangling schedule for a challenge that no longer exists
    due.push({
      id: ch.id,
      title: ch.title,
      topic: ch.topic,
      difficulty: ch.difficulty,
      runner: ch.runner,
      dueDay: row.due_day,
      reps: row.reps,
    });
  }
  return { today, due };
}

/** How many reviews are due today (ignoring dangling ids). Cheap enough to inline. */
export function countDueReviews(db, store, timeZone, clock = () => new Date()) {
  return buildReviewQueue(db, store, timeZone, clock).due.length;
}

/**
 * Apply a grade to a challenge's review, persisting the new schedule. Returns the
 * updated schedule, or null if the challenge isn't currently scheduled (the caller
 * turns that into a 404).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 * @param {'again'|'good'|'easy'} grade
 * @param {string} timeZone
 * @param {() => Date} [clock]
 */
export function gradeReview(db, challengeId, grade, timeZone, clock = () => new Date()) {
  const prev = getReview(db, challengeId);
  if (!prev) return null;
  const today = dayInTz(clock(), timeZone);
  const next = schedule(prev, grade, today);
  return saveReview(db, challengeId, next);
}

/** How many days to spread backfilled reviews across, so they don't all pile up. */
const BACKFILL_SPREAD_DAYS = 14;

/**
 * One-time enrolment of challenges solved *before* review scheduling existed. Review
 * rows are normally created on a challenge's first solve, so on the deploy that adds
 * this feature every already-solved challenge has none and would never surface. This
 * seeds one review per solved-but-unscheduled challenge, staggering their first due
 * dates across the next two weeks so the queue is populated but paced rather than
 * dumping dozens of cards on day one.
 *
 * Gated by a `meta` flag so it runs exactly once; afterwards new solves enrol
 * themselves through recordSolve as usual. Dangling solved rows (a challenge the
 * store no longer knows) are skipped.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../challenges/loader.js').ChallengeStore} store
 * @param {string} timeZone
 * @param {() => Date} [clock]
 * @returns {{ enrolled: number, alreadyDone: boolean }}
 */
export function backfillReviews(db, store, timeZone, clock = () => new Date()) {
  if (getMeta(db, 'reviews_backfilled') === '1') {
    return { enrolled: 0, alreadyDone: true };
  }

  const today = dayInTz(clock(), timeZone);
  const rows = db
    .prepare(
      `SELECT challenge_id FROM progress
        WHERE status = 'solved'
          AND challenge_id NOT IN (SELECT challenge_id FROM reviews)
        ORDER BY solved_at ASC, challenge_id ASC`,
    )
    .all();

  let enrolled = 0;
  for (const { challenge_id } of rows) {
    if (!store.get(challenge_id)) continue; // skip a challenge that no longer exists
    const offset = (enrolled % BACKFILL_SPREAD_DAYS) + 1; // 1..14 days out
    ensureReview(db, challenge_id, {
      ease: INITIAL_EASE,
      interval_days: offset,
      reps: 1,
      due_day: addDays(today, offset),
    });
    enrolled += 1;
  }

  setMeta(db, 'reviews_backfilled', '1');
  return { enrolled, alreadyDone: false };
}

export { dayInTz };
