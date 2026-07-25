// Import/export tests. The important properties: a round-trip preserves state
// exactly (including review schedules and authored challenges), the version guard
// rejects foreign files, 'replace' wipes while 'merge' upserts, and a tampered
// authored challenge is skipped rather than trusted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportData, importData, EXPORT_VERSION } from '../src/services/dataTransfer.js';
import { recordSolve } from '../src/services/progress.js';
import { gradeReview } from '../src/services/review.js';
import { createAuthored } from '../src/services/authoring.js';
import { ChallengeRegistry } from '../src/challenges/loader.js';
import { getProgress, getSolveDays } from '../src/db/progressRepo.js';
import { getReview } from '../src/db/reviewsRepo.js';
import { getAuthoredRow } from '../src/db/authoredRepo.js';
import { memoryDb, fixtureStore, makeTestApp, cookieFrom, testConfig } from './helpers.js';

const quiet = { warn() {} };
const clockAt = (iso) => () => new Date(iso);

function authoredPayload(overrides = {}) {
  return {
    id: 'ported',
    title: 'Ported',
    topic: 'custom',
    difficulty: 3,
    description: 'desc',
    starter_code: 'x = 1\n',
    tests: 'check(True, "ok")\n',
    hints: [],
    solution: 'x = 1\n',
    ...overrides,
  };
}

/** A db seeded with progress, a graded review, and one authored challenge. */
function seededDb() {
  const db = memoryDb();
  const registry = new ChallengeRegistry(fixtureStore().all());
  recordSolve(db, 'demo', 'UTC', clockAt('2026-06-01T10:00:00Z'));
  gradeReview(db, 'demo', 'easy', 'UTC', clockAt('2026-06-02T10:00:00Z'));
  createAuthored(db, registry, authoredPayload(), quiet);
  return db;
}

test('export produces a versioned envelope with every dataset', () => {
  const env = exportData(seededDb());
  assert.equal(env.version, EXPORT_VERSION);
  assert.equal(env.app, 'pypocket');
  assert.equal(env.progress.length, 1);
  assert.deepEqual(env.solveDays, ['2026-06-01']);
  assert.equal(env.reviews.length, 1);
  assert.equal(env.authoredChallenges.length, 1);
  // Authored challenge is embedded as a readable object, not a JSON string.
  assert.equal(env.authoredChallenges[0].challenge.title, 'Ported');
});

test('round-trip into a fresh db restores state exactly', () => {
  const env = exportData(seededDb());

  const fresh = memoryDb();
  const res = importData(fresh, env, 'replace');
  assert.equal(res.ok, true);
  assert.equal(res.summary.authoredChallenges, 1);

  // Progress + streak preserved.
  assert.equal(getProgress(fresh, 'demo').status, 'solved');
  assert.deepEqual(getSolveDays(fresh), ['2026-06-01']);

  // The review schedule came back verbatim (the 'easy' grade pushed it well out).
  const review = getReview(fresh, 'demo');
  assert.ok(review.reps >= 2);
  assert.equal(review.due_day, exportData(seededDb()).reviews[0].due_day);

  // Authored challenge restored with its original data.
  assert.ok(getAuthoredRow(fresh, 'ported'));
});

test('import rejects a wrong version', () => {
  const res = importData(memoryDb(), { app: 'pypocket', version: 999, progress: [] }, 'replace');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /version/);
});

test('import rejects a non-object payload', () => {
  const res = importData(memoryDb(), 'just a string', 'merge');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
});

test("replace wipes prior state; merge keeps it", () => {
  // Start with a db that already has an unrelated solve.
  const base = memoryDb();
  recordSolve(base, 'demo', 'UTC', clockAt('2026-01-01T10:00:00Z'));

  const incoming = exportData(seededDb()); // has solve on 2026-06-01

  // Merge: union of solve-days (both days present).
  const merged = memoryDb();
  recordSolve(merged, 'demo', 'UTC', clockAt('2026-01-01T10:00:00Z'));
  importData(merged, incoming, 'merge');
  assert.deepEqual(getSolveDays(merged), ['2026-01-01', '2026-06-01']);

  // Replace: only the incoming day survives.
  const replaced = memoryDb();
  recordSolve(replaced, 'demo', 'UTC', clockAt('2026-01-01T10:00:00Z'));
  importData(replaced, incoming, 'replace');
  assert.deepEqual(getSolveDays(replaced), ['2026-06-01']);
});

test('import skips a tampered authored challenge instead of trusting it', () => {
  const env = exportData(seededDb());
  // Corrupt the embedded challenge (difficulty out of range).
  env.authoredChallenges[0].challenge.difficulty = 99;

  const fresh = memoryDb();
  const res = importData(fresh, env, 'replace');
  assert.equal(res.ok, true);
  assert.equal(res.summary.authoredChallenges, 0);
  assert.equal(res.summary.skippedAuthored, 1);
  assert.equal(getAuthoredRow(fresh, 'ported'), undefined);
});

// --- HTTP round-trip -----------------------------------------------------------

test('GET export then POST import round-trips over HTTP and refreshes the store', async () => {
  const { app, db } = await makeTestApp();
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: testConfig.password },
  });
  const cookie = cookieFrom(login);

  // Author a challenge, then export.
  await app.inject({
    method: 'POST',
    url: '/api/authored',
    headers: { cookie },
    payload: authoredPayload(),
  });
  const exp = await app.inject({ method: 'GET', url: '/api/data/export', headers: { cookie } });
  assert.equal(exp.statusCode, 200);
  assert.match(exp.headers['content-disposition'], /pypocket-backup-.*\.json/);
  const envelope = JSON.parse(exp.body);

  // Import into the same app with replace; the authored challenge should still be
  // reachable through the live (rebuilt) store afterwards.
  const imp = await app.inject({
    method: 'POST',
    url: '/api/data/import?mode=replace',
    headers: { cookie },
    payload: envelope,
  });
  assert.equal(imp.statusCode, 200);
  assert.equal(JSON.parse(imp.body).mode, 'replace');

  const ch = await app.inject({ method: 'GET', url: '/api/challenges/ported', headers: { cookie } });
  assert.equal(ch.statusCode, 200);

  await app.close();
});
