// Tests for the Phase 2 server-run endpoints. The runner container itself can't run
// here (no Docker/Python), so we stub the runner and verify the Node-side contract:
// routing, authoritative grading, hidden tests, and clean failure when the runner is
// down. The Python runner is verified by inspection + on deploy (see NOTES.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChallengeStore } from '../src/challenges/loader.js';
import { getProgress } from '../src/db/progressRepo.js';
import { makeTestApp, cookieFrom, testConfig } from './helpers.js';

/** A store with one server-run challenge (hidden tests). */
function serverStore() {
  return new ChallengeStore([
    {
      id: 'srv',
      title: 'Server Demo',
      topic: 'mixed',
      tags: [],
      difficulty: 3,
      order: 10,
      runner: 'server',
      description: 'runs on the server',
      starter_code: 'def f():\n    pass\n',
      tests: 'check(f() == 42, "returns 42")\n',
      hints: [],
      solution: 'def f():\n    return 42\n',
    },
  ]);
}

/** Log in and return the session cookie header. */
async function login(app) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: testConfig.password },
  });
  return cookieFrom(res);
}

test('server challenge hides its tests from the client', async () => {
  const { app } = await makeTestApp({ store: serverStore(), runner: { run: async () => ({}) } });
  const cookie = await login(app);
  const res = await app.inject({ method: 'GET', url: '/api/challenges/srv', headers: { cookie } });
  const body = JSON.parse(res.body);
  assert.equal(body.runner, 'server');
  assert.equal(body.tests, undefined, 'tests must not be sent to the browser');
  await app.close();
});

test('run-server proxies code to the runner and returns its output', async () => {
  let received;
  const runner = {
    run: async (input) => {
      received = input;
      return { status: 'ok', stdout: 'hello\n', stderr: '', results: [], passed: false, error: null };
    },
  };
  const { app } = await makeTestApp({ store: serverStore(), runner });
  const cookie = await login(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/challenges/srv/run-server',
    headers: { cookie },
    payload: { code: 'print("hello")' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).stdout, 'hello\n');
  assert.equal(received.code, 'print("hello")');
  assert.equal(received.tests, '', 'run mode sends no tests');
  await app.close();
});

test('submit-server grades authoritatively and records a solve when passed', async () => {
  const runner = {
    run: async (input) => {
      // The backend must send the hidden tests it holds, not the client.
      assert.ok(input.tests.includes('check('), 'backend supplies the hidden tests');
      return { status: 'ok', stdout: '', stderr: '', results: [{ ok: true, msg: 'returns 42' }], passed: true, error: null };
    },
  };
  const { app, db } = await makeTestApp({ store: serverStore(), runner });
  const cookie = await login(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/challenges/srv/submit-server',
    headers: { cookie },
    payload: { code: 'def f():\n    return 42\n' },
  });
  const body = JSON.parse(res.body);
  assert.equal(body.passed, true);
  assert.equal(body.streak.current, 1, 'a solve updates the streak');
  assert.equal(getProgress(db, 'srv').status, 'solved', 'solve recorded server-side');
  await app.close();
});

test('submit-server does NOT record a solve when tests fail', async () => {
  const runner = {
    run: async () => ({ status: 'ok', stdout: '', stderr: '', results: [{ ok: false, msg: 'nope' }], passed: false, error: null }),
  };
  const { app, db } = await makeTestApp({ store: serverStore(), runner });
  const cookie = await login(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/challenges/srv/submit-server',
    headers: { cookie },
    payload: { code: 'def f():\n    return 0\n' },
  });
  assert.equal(JSON.parse(res.body).passed, false);
  assert.equal(getProgress(db, 'srv').status, 'attempted', 'not solved');
  await app.close();
});

test('a runner failure returns 502, not a hang or a false pass', async () => {
  const runner = {
    run: async () => {
      throw new Error('connection refused');
    },
  };
  const { app, db } = await makeTestApp({ store: serverStore(), runner });
  const cookie = await login(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/challenges/srv/submit-server',
    headers: { cookie },
    payload: { code: 'x = 1' },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).status, 'runner_error');
  assert.notEqual(getProgress(db, 'srv')?.status, 'solved', 'a runner error never marks solved');
  await app.close();
});

test('server endpoints reject a pyodide challenge and require auth', async () => {
  // fixtureStore's "demo" challenge is a pyodide one.
  const { app } = await makeTestApp({ runner: { run: async () => ({}) } });
  const cookie = await login(app);
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/challenges/demo/run-server',
    headers: { cookie },
    payload: { code: 'x=1' },
  });
  assert.equal(wrong.statusCode, 400, 'pyodide challenge is not server-run');

  const noAuth = await app.inject({
    method: 'POST',
    url: '/api/challenges/demo/run-server',
    payload: { code: 'x=1' },
  });
  assert.equal(noAuth.statusCode, 401, 'exec endpoints require a session');
  await app.close();
});
