// Loads every challenge YAML file from disk, validates it, and builds an in-memory
// index. This runs once at boot; challenges don't change while the server is up.
//
// The loader also enforces two things beyond per-file validation:
//   1. No two files may declare the same `id` (the id is our database key).
//   2. Files that fail validation abort startup with a message naming the file.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { challengeSchema } from './schema.js';

/**
 * Recursively collect every .yaml / .yml file under a directory.
 * @param {string} dir
 * @returns {string[]} absolute file paths, sorted for deterministic ordering
 */
function findYamlFiles(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findYamlFiles(full));
    } else if (/\.ya?ml$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * A loaded, validated set of challenges plus a few convenience lookups.
 *
 * We keep three "views" so route handlers never have to remember which fields are
 * safe to expose:
 *   - list():   metadata only, for the challenge list screen.
 *   - full(id): everything the *client* legitimately needs to run the challenge
 *               (includes tests, excludes the solution).
 *   - solution(id): the reference solution, gated by the route that calls it.
 */
export class ChallengeStore {
  /** @param {import('./schema.js').Challenge[]} challenges */
  constructor(challenges) {
    // Sort by topic then in-topic order then difficulty for a sensible sequence.
    this._all = [...challenges].sort(
      (a, b) =>
        a.topic.localeCompare(b.topic) || a.order - b.order || a.difficulty - b.difficulty,
    );
    this._byId = new Map(this._all.map((c) => [c.id, c]));
  }

  /** All challenges, full objects, in display order. */
  all() {
    return this._all;
  }

  /** @param {string} id */
  get(id) {
    return this._byId.get(id);
  }

  /** Metadata-only list — safe to send to the client's list screen. */
  list() {
    return this._all.map((c) => ({
      id: c.id,
      title: c.title,
      topic: c.topic,
      tags: c.tags,
      difficulty: c.difficulty,
      order: c.order,
      runner: c.runner,
      hintCount: c.hints.length,
    }));
  }

  /**
   * Everything the client needs to render and run a challenge. Note this includes
   * `tests` (the Pyodide worker must run them) but NOT `solution`.
   * @param {string} id
   */
  full(id) {
    const c = this._byId.get(id);
    if (!c) return undefined;
    return {
      id: c.id,
      title: c.title,
      topic: c.topic,
      tags: c.tags,
      difficulty: c.difficulty,
      runner: c.runner,
      description: c.description,
      starter_code: c.starter_code,
      // Pyodide runs the tests in the browser, so it needs them. Server-run
      // challenges execute on the backend, so their tests stay hidden — never sent.
      tests: c.runner === 'server' ? undefined : c.tests,
      hintCount: c.hints.length,
    };
  }

  /**
   * A single hint by index (0-based), or undefined if out of range.
   * @param {string} id
   * @param {number} index
   */
  hint(id, index) {
    const c = this._byId.get(id);
    if (!c) return undefined;
    return c.hints[index];
  }

  /** @param {string} id */
  solution(id) {
    return this._byId.get(id)?.solution;
  }

  /** Distinct topics in display order (first appearance wins). */
  topics() {
    const seen = new Set();
    /** @type {string[]} */
    const ordered = [];
    for (const c of this._all) {
      if (!seen.has(c.topic)) {
        seen.add(c.topic);
        ordered.push(c.topic);
      }
    }
    return ordered;
  }
}

/**
 * Read + validate all challenge files under `dir` and return a ChallengeStore.
 * Throws with a readable message if any file is malformed or ids collide.
 * @param {string} dir
 * @returns {ChallengeStore}
 */
export function loadChallenges(dir) {
  const files = findYamlFiles(dir);
  /** @type {import('./schema.js').Challenge[]} */
  const challenges = [];
  /** @type {Map<string, string>} id -> file that first declared it */
  const idToFile = new Map();

  for (const file of files) {
    let raw;
    try {
      raw = YAML.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Challenge file ${file} is not valid YAML: ${err.message}`);
    }

    const parsed = challengeSchema.safeParse(raw);
    if (!parsed.success) {
      // zod's error lists every bad field; prefix it with the filename.
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      throw new Error(`Challenge file ${file} is invalid:\n${issues}`);
    }

    const challenge = parsed.data;
    const clash = idToFile.get(challenge.id);
    if (clash) {
      throw new Error(
        `Duplicate challenge id "${challenge.id}" in ${file} — already used by ${clash}.`,
      );
    }
    idToFile.set(challenge.id, file);
    challenges.push(challenge);
  }

  return new ChallengeStore(challenges);
}
