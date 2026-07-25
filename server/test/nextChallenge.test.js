// Tests for the "Next challenge" picker. The load-bearing property is the
// progression invariant: it must return the *easiest* unsolved challenge in the
// preferred topic, never a harder one while an easier unsolved one exists — with
// randomness only in *which* challenge of that easiest tier is chosen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNextChallenge } from '../src/services/nextChallenge.js';
import { ChallengeStore } from '../src/challenges/loader.js';
import { markSolved } from '../src/db/progressRepo.js';
import { makeTestApp, cookieFrom, testConfig } from './helpers.js';

/** A ChallengeStore with a few challenges for the HTTP test. */
function multiStore() {
  const base = {
    tags: [],
    order: 10,
    runner: 'pyodide',
    description: 'x',
    starter_code: 'pass\n',
    tests: 'check(True, "ok")\n',
    hints: [],
    solution: 'pass\n',
  };
  return new ChallengeStore([
    { ...base, id: 'a-1', title: 'A1', topic: 'a', difficulty: 1 },
    { ...base, id: 'a-3', title: 'A3', topic: 'a', difficulty: 3 },
    { ...base, id: 'b-1', title: 'B1', topic: 'b', difficulty: 1 },
  ]);
}

/** A little challenge set spanning two topics and several difficulties. */
function fixture() {
  return [
    { id: 'a-easy1', topic: 'a', difficulty: 1 },
    { id: 'a-easy2', topic: 'a', difficulty: 1 },
    { id: 'a-mid', topic: 'a', difficulty: 3 },
    { id: 'a-hard', topic: 'a', difficulty: 5 },
    { id: 'b-easy', topic: 'b', difficulty: 1 },
    { id: 'b-hard', topic: 'b', difficulty: 4 },
  ];
}

const rngHalf = () => 0.5;

test('picks the easiest tier in the current topic (progression invariant)', () => {
  // On the hard 'a' challenge; the easiest unsolved 'a' challenges are the two d1s.
  const chosen = pickNextChallenge(fixture(), [], 'a-hard', () => 0);
  assert.ok(['a-easy1', 'a-easy2'].includes(chosen), 'must be a d1 in topic a');
});

test('never returns the current challenge or a solved one', () => {
  const solved = ['a-easy1'];
  for (let r = 0; r < 1; r += 0.1) {
    const chosen = pickNextChallenge(fixture(), solved, 'a-easy2', () => r);
    assert.notEqual(chosen, 'a-easy2', 'not the current one');
    assert.notEqual(chosen, 'a-easy1', 'not a solved one');
  }
});

test('advances to the next tier once the easy ones are solved', () => {
  // Both d1s in topic a are solved (and we're on one of them) -> next easiest is d3.
  const chosen = pickNextChallenge(fixture(), ['a-easy1', 'a-easy2'], 'a-easy1', rngHalf);
  assert.equal(chosen, 'a-mid', 'the d3 is now the easiest unsolved in topic a');
});

test('stays in the current topic while it has unsolved challenges', () => {
  // On a topic-b challenge, but only harder b remains vs an easy a. Must stay in b.
  // 'b-hard' is current and 'b-easy' is solved, so topic b has no other unsolved →
  // it falls through to topic a's easiest (a d1).
  const chosen = pickNextChallenge(fixture(), ['b-easy'], 'b-hard', rngHalf);
  assert.ok(['a-easy1', 'a-easy2'].includes(chosen), 'topic b exhausted, falls to a d1');
});

test('prefers the same topic over an easier challenge elsewhere', () => {
  // On a-hard; topic a still has d1s. Even though b also has a d1, we stay in a.
  const chosen = pickNextChallenge(fixture(), [], 'a-hard', () => 0);
  assert.equal(chosen.startsWith('a-'), true, 'stays in topic a');
});

test('returns null when everything is solved', () => {
  const all = fixture().map((c) => c.id);
  assert.equal(pickNextChallenge(fixture(), all, 'a-easy1'), null);
});

test('randomness reaches every member of the easiest tier, and only that tier', () => {
  const reached = new Set();
  for (let i = 0; i < 50; i++) {
    const chosen = pickNextChallenge(fixture(), [], 'a-hard', () => i / 50);
    // Always within the easiest (d1) tier of topic a.
    assert.ok(['a-easy1', 'a-easy2'].includes(chosen), `stayed in easiest tier: ${chosen}`);
    reached.add(chosen);
  }
  assert.deepEqual([...reached].sort(), ['a-easy1', 'a-easy2'], 'both d1 challenges are reachable');
});

test('clamps when the rng returns 1', () => {
  const chosen = pickNextChallenge(fixture(), [], 'a-hard', () => 1);
  assert.ok(['a-easy1', 'a-easy2'].includes(chosen), 'no out-of-bounds pick');
});

test('with no current challenge, picks the global easiest tier', () => {
  const chosen = pickNextChallenge(fixture(), [], undefined, () => 0);
  // Global easiest is d1: a-easy1, a-easy2, b-easy.
  assert.ok(['a-easy1', 'a-easy2', 'b-easy'].includes(chosen));
});

test('GET /api/next-challenge returns the easiest unsolved in the current topic', async () => {
  const { app, db } = await makeTestApp({ store: multiStore() });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: testConfig.password },
  });
  const cookie = cookieFrom(login);

  // From a hard topic-a challenge with nothing solved → the d1 in topic a.
  const res = await app.inject({
    method: 'GET',
    url: '/api/next-challenge?from=a-3',
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).next, 'a-1', 'the easiest unsolved in topic a');

  // Solve a-1; topic a's only other challenge is a-3 (the current one), so it falls
  // through to topic b's d1.
  markSolved(db, 'a-1');
  const res2 = await app.inject({
    method: 'GET',
    url: '/api/next-challenge?from=a-3',
    headers: { cookie },
  });
  assert.equal(JSON.parse(res2.body).next, 'b-1', 'topic a exhausted, moves to b');

  await app.close();
});
