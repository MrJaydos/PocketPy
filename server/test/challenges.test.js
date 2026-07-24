// Tests for the challenge loader — the "tricky bit" of turning hand-authored YAML
// into validated, safely-exposed data. We write fixture files to a temp dir so each
// test controls exactly what the loader sees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChallenges } from '../src/challenges/loader.js';

/** Create a fresh temp directory and return its path. */
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pypocket-test-'));
}

/** A complete, valid challenge as a YAML string, with overridable fields. */
function validYaml(overrides = {}) {
  const c = {
    id: 'sample-one',
    title: 'Sample One',
    topic: 'basics',
    difficulty: 2,
    order: 10,
    description: 'Do a thing.',
    starter_code: 'def f():\n    pass\n',
    tests: 'check(f() is None, "returns None")\n',
    hints: ['first hint', 'second hint'],
    solution: 'def f():\n    return None\n',
    ...overrides,
  };
  // Hand-build YAML with block scalars for the multi-line code fields.
  return [
    `id: ${c.id}`,
    `title: ${c.title}`,
    `topic: ${c.topic}`,
    `difficulty: ${c.difficulty}`,
    `order: ${c.order}`,
    `description: |\n  ${c.description}`,
    `starter_code: |\n${c.starter_code.replace(/^/gm, '  ')}`,
    `tests: |\n${c.tests.replace(/^/gm, '  ')}`,
    `hints:\n${c.hints.map((h) => `  - ${h}`).join('\n')}`,
    `solution: |\n${c.solution.replace(/^/gm, '  ')}`,
  ].join('\n');
}

test('loads valid challenges and exposes safe views', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.yaml'), validYaml());
  const store = loadChallenges(dir);

  assert.equal(store.all().length, 1);

  // The list view must not leak tests or the solution.
  const [meta] = store.list();
  assert.equal(meta.id, 'sample-one');
  assert.equal(meta.hintCount, 2);
  assert.ok(!('tests' in meta), 'list view must not include tests');
  assert.ok(!('solution' in meta), 'list view must not include solution');

  // The full view includes tests (the worker needs them) but never the solution.
  const full = store.full('sample-one');
  assert.ok(full.tests.includes('check('), 'full view includes tests');
  assert.ok(!('solution' in full), 'full view must not include solution');

  // The solution is only reachable via the dedicated accessor.
  assert.ok(store.solution('sample-one').includes('return None'));

  // Hints are addressable by index.
  assert.equal(store.hint('sample-one', 1), 'second hint');
  assert.equal(store.hint('sample-one', 5), undefined);
});

test('rejects duplicate ids across files', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.yaml'), validYaml({ id: 'dupe' }));
  fs.writeFileSync(path.join(dir, 'b.yaml'), validYaml({ id: 'dupe' }));
  assert.throws(() => loadChallenges(dir), /Duplicate challenge id "dupe"/);
});

test('rejects difficulty outside 1..5', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.yaml'), validYaml({ difficulty: 9 }));
  assert.throws(() => loadChallenges(dir), /difficulty/);
});

test('rejects a missing required field', () => {
  const dir = tmpDir();
  // Remove the tests field entirely.
  const yaml = validYaml().replace(/tests: \|[\s\S]*?(?=\nhints:)/, '');
  fs.writeFileSync(path.join(dir, 'a.yaml'), yaml);
  assert.throws(() => loadChallenges(dir), /is invalid/);
});

test('rejects unknown fields (typo protection)', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.yaml'), validYaml() + '\ndifficutly: 3\n');
  assert.throws(() => loadChallenges(dir), /is invalid/);
});

test('rejects malformed YAML with a filename in the message', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bad.yaml'), 'id: [unclosed\n');
  assert.throws(() => loadChallenges(dir), /bad\.yaml is not valid YAML/);
});

test('sorts by topic, order, then difficulty', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.yaml'), validYaml({ id: 'b-first', topic: 'b', order: 10 }));
  fs.writeFileSync(path.join(dir, 'b.yaml'), validYaml({ id: 'a-first', topic: 'a', order: 20 }));
  fs.writeFileSync(path.join(dir, 'c.yaml'), validYaml({ id: 'a-second', topic: 'a', order: 30 }));
  const ids = loadChallenges(dir).all().map((c) => c.id);
  assert.deepEqual(ids, ['a-first', 'a-second', 'b-first']);
});
