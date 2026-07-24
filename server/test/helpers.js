// Shared test helpers: build an app wired to an in-memory database and a tiny
// fixture challenge set, so route tests run fast and in isolation with no files or
// real ports involved.

import Database from 'better-sqlite3';
import { migrate } from '../src/db/db.js';
import { ChallengeStore } from '../src/challenges/loader.js';
import { buildApp } from '../src/app.js';

/** A config object shaped like src/config.js but safe for tests. */
export const testConfig = {
  isProduction: false,
  port: 0,
  host: '127.0.0.1',
  password: 'secret-test-password',
  sessionSecret: 'test-session-secret-at-least-32-characters-long',
  dbPath: ':memory:',
  appTz: 'UTC',
  challengesDir: '',
  clientDist: '',
  sessionMaxAgeSeconds: 3600,
};

/** A fresh in-memory database with the schema applied. */
export function memoryDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

/** A minimal, valid ChallengeStore for route tests. */
export function fixtureStore() {
  return new ChallengeStore([
    {
      id: 'demo',
      title: 'Demo',
      topic: 'basics',
      tags: [],
      difficulty: 1,
      order: 10,
      runner: 'pyodide',
      description: 'demo',
      starter_code: 'def f():\n    pass\n',
      tests: 'check(True, "always")\n',
      hints: ['hint one', 'hint two'],
      solution: 'def f():\n    return 1\n',
    },
  ]);
}

/** Build an app for testing, returning { app, db }. Remember to app.close(). */
export async function makeTestApp(overrides = {}) {
  const db = overrides.db ?? memoryDb();
  const app = await buildApp({
    config: { ...testConfig, ...(overrides.config ?? {}) },
    db,
    store: overrides.store ?? fixtureStore(),
    serveClient: false,
  });
  return { app, db };
}

/** Extract the session cookie string from a login response for reuse. */
export function cookieFrom(loginResponse) {
  const raw = loginResponse.headers['set-cookie'];
  if (!raw) return undefined; // e.g. a failed login sets no cookie
  const arr = Array.isArray(raw) ? raw : [raw];
  // Return just the "name=value" part of the pp_session cookie.
  return arr.map((c) => c.split(';')[0]).find((c) => c.startsWith('pp_session='));
}
