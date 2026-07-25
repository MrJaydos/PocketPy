// Tests for in-app challenge authoring. These cover the two things with real blast
// radius: the write-time policy (validation, id collisions, path-id authority) and
// that authored challenges merge into the same store the rest of the app reads,
// while a corrupt row can never brick the loader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAuthored, loadAuthored } from '../src/challenges/authored.js';
import {
  createAuthored,
  updateAuthored,
  removeAuthored,
  getAuthoredFull,
} from '../src/services/authoring.js';
import { ChallengeRegistry } from '../src/challenges/loader.js';
import { upsertAuthored } from '../src/db/authoredRepo.js';
import { getProgress } from '../src/db/progressRepo.js';
import { getReview } from '../src/db/reviewsRepo.js';
import { recordSolve } from '../src/services/progress.js';
import { memoryDb, fixtureStore, makeTestApp, cookieFrom, testConfig } from './helpers.js';

/** A complete, valid authored-challenge payload with overridable fields. */
function payload(overrides = {}) {
  return {
    id: 'my-first',
    title: 'My First',
    topic: 'custom',
    difficulty: 2,
    description: 'Do a thing.',
    starter_code: 'def f():\n    pass\n',
    tests: 'check(f() == 1, "returns 1")\n',
    hints: ['think'],
    solution: 'def f():\n    return 1\n',
    ...overrides,
  };
}

/** A registry seeded with the fixture "demo" challenge, like the real app. */
function seededRegistry() {
  return new ChallengeRegistry(fixtureStore().all());
}

const quiet = { warn() {} };

test('validateAuthored accepts a good challenge and rejects a bad one', () => {
  assert.equal(validateAuthored(payload()).ok, true);

  const missing = validateAuthored(payload({ tests: undefined }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.startsWith('tests')));
});

test('validateAuthored forbids server-run authored challenges', () => {
  const res = validateAuthored(payload({ runner: 'server' }));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('browser')));
});

test('createAuthored persists, merges into the store, and blocks duplicate ids', () => {
  const db = memoryDb();
  const registry = seededRegistry();

  const created = createAuthored(db, registry, payload(), quiet);
  assert.equal(created.ok, true);
  // It now shows up in the merged store alongside the seed challenge.
  assert.ok(registry.get('my-first'), 'authored challenge is in the store');
  assert.ok(registry.get('demo'), 'seed challenge is still there');

  // A second create with the same id is a conflict.
  const dupe = createAuthored(db, registry, payload(), quiet);
  assert.equal(dupe.ok, false);
  assert.equal(dupe.status, 409);
});

test('createAuthored refuses to shadow a built-in (seed) id', () => {
  const db = memoryDb();
  const registry = seededRegistry();
  const res = createAuthored(db, registry, payload({ id: 'demo' }), quiet);
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.match(res.error, /built-in/);
});

test('updateAuthored pins the id to the path, ignoring a mismatched body id', () => {
  const db = memoryDb();
  const registry = seededRegistry();
  createAuthored(db, registry, payload(), quiet);

  // Try to change the id via the body — it must be ignored, not honoured.
  const res = updateAuthored(db, registry, 'my-first', payload({ id: 'sneaky', title: 'Renamed' }), quiet);
  assert.equal(res.ok, true);
  assert.equal(res.challenge.id, 'my-first', 'id stays pinned to the path');
  assert.equal(getAuthoredFull(db, 'my-first').title, 'Renamed');
  assert.equal(getAuthoredFull(db, 'sneaky'), null, 'no orphan row is created');
});

test('updateAuthored 404s for an unknown id', () => {
  const db = memoryDb();
  const registry = seededRegistry();
  const res = updateAuthored(db, registry, 'nope', payload({ id: 'nope' }), quiet);
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test('removeAuthored deletes the challenge and its progress + review state', () => {
  const db = memoryDb();
  const registry = seededRegistry();
  createAuthored(db, registry, payload(), quiet);

  // Give it some per-challenge state, the way solving/scheduling would.
  recordSolve(db, 'my-first', 'UTC', () => new Date('2026-05-01T10:00:00Z'));
  assert.ok(getProgress(db, 'my-first'), 'has progress');
  assert.ok(getReview(db, 'my-first'), 'has a review');

  const res = removeAuthored(db, registry, 'my-first', quiet);
  assert.equal(res.ok, true);
  assert.equal(registry.get('my-first'), undefined, 'gone from the store');
  assert.equal(getProgress(db, 'my-first'), undefined, 'progress cleaned up');
  assert.equal(getReview(db, 'my-first'), undefined, 'review cleaned up');

  assert.equal(removeAuthored(db, registry, 'my-first', quiet).status, 404, 'second delete 404s');
});

test('loadAuthored skips corrupt / invalid / mismatched rows instead of throwing', () => {
  const db = memoryDb();
  upsertAuthored(db, 'good', JSON.stringify(payload({ id: 'good' })));
  upsertAuthored(db, 'bad-json', '{ not valid json');
  upsertAuthored(db, 'bad-schema', JSON.stringify({ id: 'bad-schema', title: 'x' })); // missing fields
  upsertAuthored(db, 'mismatch', JSON.stringify(payload({ id: 'different-id' })));

  const loaded = loadAuthored(db, quiet);
  assert.deepEqual(loaded.map((c) => c.id), ['good'], 'only the valid row loads');
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

test('authored CRUD round-trips over HTTP and the new challenge is fetchable', async () => {
  const { app, cookie } = await loggedInApp();

  const created = await app.inject({
    method: 'POST',
    url: '/api/authored',
    headers: { cookie },
    payload: payload(),
  });
  assert.equal(created.statusCode, 201);

  // It's now visible through the normal challenge endpoint (merged store), with its
  // tests included (pyodide challenge) but never its solution.
  const full = await app.inject({ method: 'GET', url: '/api/challenges/my-first', headers: { cookie } });
  assert.equal(full.statusCode, 200);
  const body = JSON.parse(full.body);
  assert.ok(body.tests.includes('check('));
  assert.ok(!('solution' in body));

  // The authoring editor endpoint returns the full record incl. the solution.
  const forEdit = await app.inject({ method: 'GET', url: '/api/authored/my-first', headers: { cookie } });
  assert.ok(JSON.parse(forEdit.body).solution.includes('return 1'));

  const del = await app.inject({ method: 'DELETE', url: '/api/authored/my-first', headers: { cookie } });
  assert.equal(del.statusCode, 200);
  const gone = await app.inject({ method: 'GET', url: '/api/challenges/my-first', headers: { cookie } });
  assert.equal(gone.statusCode, 404);

  await app.close();
});

test('POST /api/authored returns 400 with details for an invalid challenge', async () => {
  const { app, cookie } = await loggedInApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/authored',
    headers: { cookie },
    payload: payload({ difficulty: 99 }),
  });
  assert.equal(res.statusCode, 400);
  assert.ok(Array.isArray(JSON.parse(res.body).details));
  await app.close();
});
