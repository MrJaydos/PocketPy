// Spaced-repetition tests. The scheduling ladder is the fiddly bit (1 → 6 →
// interval×ease, a lapse resets it, 'easy' grows the ease), so most of these hit the
// pure schedule() function with fixed inputs. A few exercise the db/store
// orchestration and the HTTP routes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule,
  initialSchedule,
  buildReviewQueue,
  countDueReviews,
  gradeReview,
} from '../src/services/review.js';
import { recordSolve } from '../src/services/progress.js';
import { getReview, ensureReview } from '../src/db/reviewsRepo.js';
import { memoryDb, fixtureStore, makeTestApp, cookieFrom, testConfig } from './helpers.js';

const clockAt = (iso) => () => new Date(iso);

test('schedule: good grade walks the 1 → 6 → interval×ease ladder', () => {
  // First success: due in 1 day.
  const s1 = schedule({ ease: 2.5, interval_days: 0, reps: 0 }, 'good', '2026-01-01');
  assert.equal(s1.reps, 1);
  assert.equal(s1.interval_days, 1);
  assert.equal(s1.due_day, '2026-01-02');

  // Second success: jumps to 6 days.
  const s2 = schedule(s1, 'good', '2026-01-02');
  assert.equal(s2.reps, 2);
  assert.equal(s2.interval_days, 6);
  assert.equal(s2.due_day, '2026-01-08');

  // Third success: interval × ease (6 × 2.5 = 15), ease unchanged by 'good'.
  const s3 = schedule(s2, 'good', '2026-01-08');
  assert.equal(s3.reps, 3);
  assert.equal(s3.ease, 2.5);
  assert.equal(s3.interval_days, 15);
});

test('schedule: again resets reps and interval and lowers ease', () => {
  const prev = { ease: 2.5, interval_days: 15, reps: 3 };
  const s = schedule(prev, 'again', '2026-01-10');
  assert.equal(s.reps, 0);
  assert.equal(s.interval_days, 1);
  assert.equal(s.due_day, '2026-01-11');
  assert.ok(Math.abs(s.ease - 2.3) < 1e-9, 'ease drops by 0.2');
});

test('schedule: ease never falls below the 1.3 floor', () => {
  let s = { ease: 1.4, interval_days: 1, reps: 0 };
  s = schedule(s, 'again', '2026-01-01'); // 1.4 - 0.2 = 1.2 → clamped to 1.3
  assert.equal(s.ease, 1.3);
  s = schedule(s, 'again', '2026-01-02'); // stays clamped
  assert.equal(s.ease, 1.3);
});

test('schedule: easy nudges the ease factor up', () => {
  const s = schedule({ ease: 2.5, interval_days: 6, reps: 2 }, 'easy', '2026-01-01');
  assert.ok(s.ease > 2.5, 'easy grows ease');
  assert.ok(Math.abs(s.ease - 2.6) < 1e-9);
});

test('schedule: rejects an unknown grade', () => {
  assert.throws(() => schedule({}, 'meh', '2026-01-01'), /Unknown review grade/);
});

test('initialSchedule: seeds a first-rep card due the next day', () => {
  const s = initialSchedule('2026-01-01');
  assert.equal(s.reps, 1);
  assert.equal(s.interval_days, 1);
  assert.equal(s.due_day, '2026-01-02');
});

test('recordSolve enrols a challenge for review on first solve only', () => {
  const db = memoryDb();
  recordSolve(db, 'demo', 'UTC', clockAt('2026-03-01T09:00:00Z'));

  const row = getReview(db, 'demo');
  assert.ok(row, 'a review row is created on first solve');
  assert.equal(row.due_day, '2026-03-02');
  assert.equal(row.reps, 1);

  // Solving again the same challenge must not reset its (possibly advanced) schedule.
  recordSolve(db, 'demo', 'UTC', clockAt('2026-03-05T09:00:00Z'));
  assert.equal(getReview(db, 'demo').due_day, '2026-03-02', 'schedule is untouched by re-solving');
});

test('buildReviewQueue returns only due rows and skips dangling ids', () => {
  const db = memoryDb();
  const store = fixtureStore(); // only knows the 'demo' challenge

  // 'demo' is due today; 'ghost' is due today but its challenge no longer exists.
  ensureReview(db, 'demo', { ease: 2.5, interval_days: 1, reps: 1, due_day: '2026-03-10' });
  ensureReview(db, 'ghost', { ease: 2.5, interval_days: 1, reps: 1, due_day: '2026-03-10' });
  // A future card that should NOT appear yet.
  ensureReview(db, 'demo-future', { ease: 2.5, interval_days: 30, reps: 3, due_day: '2026-04-01' });

  const clock = clockAt('2026-03-10T12:00:00Z');
  const { due } = buildReviewQueue(db, store, 'UTC', clock);
  assert.deepEqual(due.map((d) => d.id), ['demo'], 'dangling + future rows are excluded');
  assert.equal(due[0].title, 'Demo');
  assert.equal(countDueReviews(db, store, 'UTC', clock), 1);
});

test('gradeReview reschedules an existing review and returns null otherwise', () => {
  const db = memoryDb();
  ensureReview(db, 'demo', { ease: 2.5, interval_days: 1, reps: 1, due_day: '2026-03-10' });

  const row = gradeReview(db, 'demo', 'good', 'UTC', clockAt('2026-03-10T12:00:00Z'));
  assert.equal(row.reps, 2);
  assert.equal(row.due_day, '2026-03-16'); // second success → 6 days out
  assert.ok(row.last_reviewed_at, 'grading stamps the review time');

  assert.equal(gradeReview(db, 'never-scheduled', 'good', 'UTC'), null);
});

// --- HTTP routes --------------------------------------------------------------

async function loggedInApp() {
  const { app, db } = await makeTestApp();
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: testConfig.password },
  });
  return { app, db, cookie: cookieFrom(login) };
}

test('GET /api/reviews returns the due queue', async () => {
  const { app, db, cookie } = await loggedInApp();
  ensureReview(db, 'demo', { ease: 2.5, interval_days: 1, reps: 1, due_day: '2000-01-01' });

  const res = await app.inject({ method: 'GET', url: '/api/reviews', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.count, 1);
  assert.equal(body.due[0].id, 'demo');
  await app.close();
});

test('POST /api/reviews/:id/grade validates and reschedules', async () => {
  const { app, db, cookie } = await loggedInApp();
  ensureReview(db, 'demo', { ease: 2.5, interval_days: 1, reps: 1, due_day: '2000-01-01' });

  const bad = await app.inject({
    method: 'POST',
    url: '/api/reviews/demo/grade',
    headers: { cookie },
    payload: { grade: 'nope' },
  });
  assert.equal(bad.statusCode, 400);

  const ok = await app.inject({
    method: 'POST',
    url: '/api/reviews/demo/grade',
    headers: { cookie },
    payload: { grade: 'good' },
  });
  assert.equal(ok.statusCode, 200);
  assert.ok(JSON.parse(ok.body).dueDay, 'returns the next due day');

  const missing = await app.inject({
    method: 'POST',
    url: '/api/reviews/does-not-exist/grade',
    headers: { cookie },
    payload: { grade: 'good' },
  });
  assert.equal(missing.statusCode, 404);
  await app.close();
});
