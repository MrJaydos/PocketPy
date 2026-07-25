// Progress + streak logic.
//
// Everything here is deliberately *pure* where possible: the streak math takes a
// list of day-strings and a "today", and returns numbers. That means the tricky
// part (do streaks break on a gap? does solving twice in a day count once?) can be
// unit-tested with plain arrays and no database or real clock.

import {
  getAllProgress,
  getSolveDays,
  recordSolveDay,
  markSolved,
  getMeta,
  setMeta,
} from '../db/progressRepo.js';
import { ensureReview } from '../db/reviewsRepo.js';
import { initialSchedule, countDueReviews } from './review.js';
import { dayInTz, addDays } from './dates.js';

// Re-exported so existing importers (tests, routes) can keep pulling these from the
// progress service; the implementations now live in dates.js.
export { dayInTz, addDays };

/**
 * Compute current and longest streaks from the set of solve-days.
 *
 * - Longest streak: the longest run of consecutive calendar days present.
 * - Current streak: the run ending today or yesterday. We allow "yesterday" so a
 *   streak isn't shown as broken simply because you haven't solved anything *yet*
 *   today; it only truly breaks once a full day passes with no solve.
 *
 * @param {string[]} days   Solve-days, any order, may contain duplicates.
 * @param {string} today    'YYYY-MM-DD' for the current day in APP_TZ.
 * @returns {{current: number, longest: number}}
 */
export function computeStreaks(days, today) {
  const set = new Set(days);
  if (set.size === 0) return { current: 0, longest: 0 };

  const sorted = [...set].sort();

  // Longest run of consecutive days.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === addDays(sorted[i - 1], 1)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Current streak: walk backwards from today (or yesterday if nothing today yet).
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  if (set.has(cursor)) {
    while (set.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  return { current, longest };
}

/**
 * Record a solve for the streak: writes the challenge as solved, and if this is the
 * first time it's solved, records today's solve-day and refreshes the cached
 * longest streak. Returns the resulting streak numbers.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} challengeId
 * @param {string} timeZone
 * @param {() => Date} [clock]  Injectable for tests; defaults to real time.
 */
export function recordSolve(db, challengeId, timeZone, clock = () => new Date()) {
  const { firstSolve } = markSolved(db, challengeId);
  const today = dayInTz(clock(), timeZone);
  if (firstSolve) {
    recordSolveDay(db, today);
    // Enrol the challenge in the spaced-repetition rotation the first time it's
    // solved. ensureReview is a no-op if it's somehow already scheduled.
    ensureReview(db, challengeId, initialSchedule(today));
  }
  const { current, longest } = computeStreaks(getSolveDays(db), today);
  setMeta(db, 'longest_streak', longest);
  return { current, longest, firstSolve };
}

/**
 * Build the dashboard payload: overall counts, streaks, per-topic completion, and
 * the id of the last challenge worked on (for "continue where you left off").
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../challenges/loader.js').ChallengeStore} store
 * @param {string} timeZone
 * @param {() => Date} [clock]
 */
export function buildDashboard(db, store, timeZone, clock = () => new Date()) {
  const progress = getAllProgress(db);
  const all = store.all();

  let solved = 0;
  let attempted = 0;
  for (const row of progress.values()) {
    if (row.status === 'solved') solved += 1;
    else if (row.status === 'attempted') attempted += 1;
  }

  // Per-topic completion percentages.
  const perTopic = store.topics().map((topic) => {
    const inTopic = all.filter((c) => c.topic === topic);
    const done = inTopic.filter((c) => progress.get(c.id)?.status === 'solved').length;
    return {
      topic,
      total: inTopic.length,
      solved: done,
      percent: inTopic.length === 0 ? 0 : Math.round((done / inTopic.length) * 100),
    };
  });

  // "Continue where you left off": most recently updated progress row that isn't
  // solved yet; falls back to the most recently updated overall.
  let lastChallengeId = null;
  let lastUpdated = '';
  for (const row of progress.values()) {
    if (row.updated_at > lastUpdated) {
      lastUpdated = row.updated_at;
      lastChallengeId = row.challenge_id;
    }
  }

  const today = dayInTz(clock(), timeZone);
  const { current, longest } = computeStreaks(getSolveDays(db), today);
  // Keep the cached longest in sync in case solve-days were imported/edited.
  setMeta(db, 'longest_streak', Math.max(longest, Number(getMeta(db, 'longest_streak') ?? 0)));

  return {
    totals: {
      total: all.length,
      solved,
      attempted,
      remaining: all.length - solved,
    },
    streak: { current, longest },
    perTopic,
    lastChallengeId,
    reviewsDue: countDueReviews(db, store, timeZone, clock),
  };
}
