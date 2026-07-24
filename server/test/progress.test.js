// Progress + streak tests. The streak math is the fiddly bit (gaps break streaks,
// two solves in one day count once, "today or yesterday" keeps a fresh day alive),
// so most of these test the pure functions directly with fixed inputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreaks, dayInTz, recordSolve, buildDashboard } from '../src/services/progress.js';
import { getProgress, getSolveDays } from '../src/db/progressRepo.js';
import { memoryDb, fixtureStore } from './helpers.js';

test('dayInTz buckets an instant into the right calendar day', () => {
  // 2026-01-01 00:30 UTC is still 2025-12-31 in New York (UTC-5).
  const instant = new Date('2026-01-01T00:30:00Z');
  assert.equal(dayInTz(instant, 'UTC'), '2026-01-01');
  assert.equal(dayInTz(instant, 'America/New_York'), '2025-12-31');
});

test('computeStreaks: empty set is zero', () => {
  assert.deepEqual(computeStreaks([], '2026-01-10'), { current: 0, longest: 0 });
});

test('computeStreaks: consecutive days build the current streak', () => {
  const days = ['2026-01-08', '2026-01-09', '2026-01-10'];
  assert.deepEqual(computeStreaks(days, '2026-01-10'), { current: 3, longest: 3 });
});

test('computeStreaks: a gap breaks the current streak but longest remembers', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-09', '2026-01-10'];
  assert.deepEqual(computeStreaks(days, '2026-01-10'), { current: 2, longest: 3 });
});

test('computeStreaks: yesterday still counts as an alive streak', () => {
  // Nothing solved *today* yet, but yesterday was — streak is not broken.
  const days = ['2026-01-08', '2026-01-09'];
  assert.deepEqual(computeStreaks(days, '2026-01-10'), { current: 2, longest: 2 });
});

test('computeStreaks: two days ago with nothing since is a broken streak', () => {
  const days = ['2026-01-07', '2026-01-08'];
  assert.deepEqual(computeStreaks(days, '2026-01-10'), { current: 0, longest: 2 });
});

test('computeStreaks: duplicate days count once', () => {
  const days = ['2026-01-10', '2026-01-10', '2026-01-10'];
  assert.deepEqual(computeStreaks(days, '2026-01-10'), { current: 1, longest: 1 });
});

test('recordSolve: solving twice in one day records a single solve-day', () => {
  const db = memoryDb();
  const clockAt = (iso) => () => new Date(iso);

  recordSolve(db, 'demo', 'UTC', clockAt('2026-03-01T09:00:00Z'));
  recordSolve(db, 'demo', 'UTC', clockAt('2026-03-01T20:00:00Z'));

  assert.deepEqual(getSolveDays(db), ['2026-03-01']);
  const row = getProgress(db, 'demo');
  assert.equal(row.status, 'solved');
});

test('recordSolve: firstSolve flag is only true the first time', () => {
  const db = memoryDb();
  const clock = () => new Date('2026-03-01T09:00:00Z');
  const first = recordSolve(db, 'a', 'UTC', clock);
  const second = recordSolve(db, 'a', 'UTC', clock);
  assert.equal(first.firstSolve, true);
  assert.equal(second.firstSolve, false);
});

test('buildDashboard: totals and per-topic percentages reflect solves', () => {
  const db = memoryDb();
  const store = fixtureStore(); // one challenge, topic "basics"
  const clock = () => new Date('2026-03-02T12:00:00Z');

  let dash = buildDashboard(db, store, 'UTC', clock);
  assert.equal(dash.totals.total, 1);
  assert.equal(dash.totals.solved, 0);
  assert.equal(dash.perTopic[0].percent, 0);

  recordSolve(db, 'demo', 'UTC', clock);
  dash = buildDashboard(db, store, 'UTC', clock);
  assert.equal(dash.totals.solved, 1);
  assert.equal(dash.perTopic[0].percent, 100);
  assert.equal(dash.streak.current, 1);
  assert.equal(dash.lastChallengeId, 'demo');
});
