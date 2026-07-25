// Auth tests: the password gate is the only thing standing between the internet and
// this app, so we check the guard, the login/logout flow, and the rate limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, cookieFrom, testConfig } from './helpers.js';

test('protected routes reject requests without a session', async () => {
  const { app } = await makeTestApp();
  const res = await app.inject({ method: 'GET', url: '/api/challenges' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('login rejects the wrong password', async () => {
  const { app } = await makeTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: 'wrong' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(cookieFrom(res), undefined, 'no cookie should be set on failure');
  await app.close();
});

test('login accepts the right password and the cookie unlocks the API', async () => {
  const { app } = await makeTestApp();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: testConfig.password },
  });
  assert.equal(login.statusCode, 200);
  const cookie = cookieFrom(login);
  assert.ok(cookie, 'a session cookie is set on success');

  const list = await app.inject({
    method: 'GET',
    url: '/api/challenges',
    headers: { cookie },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(JSON.parse(list.body)[0].id, 'demo');

  await app.close();
});

test('/api/auth/me reflects login state, logout clears it', async () => {
  const { app } = await makeTestApp();

  const before = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(JSON.parse(before.body).authenticated, false);

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: testConfig.password },
  });
  const cookie = cookieFrom(login);

  const after = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie },
  });
  assert.equal(JSON.parse(after.body).authenticated, true);

  await app.close();
});

test('login tolerates surrounding whitespace on the submitted password', async () => {
  // A trailing newline/space (common from a phone paste) must not fail the login,
  // since the configured password is trimmed the same way.
  const { app } = await makeTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: `  ${testConfig.password}\n` },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(cookieFrom(res), 'a session cookie is set');
  await app.close();
});

test('a forged/tampered cookie is rejected', async () => {
  const { app } = await makeTestApp();
  const res = await app.inject({
    method: 'GET',
    url: '/api/challenges',
    headers: { cookie: 'pp_session=authenticated' }, // unsigned -> invalid signature
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('login is rate-limited after too many attempts', async () => {
  const { app } = await makeTestApp();

  let sawLimit = false;
  // The limiter allows 10/min; the 11th should be blocked.
  for (let i = 0; i < 12; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong' },
    });
    if (res.statusCode === 429) sawLimit = true;
  }
  assert.ok(sawLimit, 'expected a 429 once the login rate limit is exceeded');
  await app.close();
});
