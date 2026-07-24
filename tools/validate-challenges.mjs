// Pre-deploy sanity check: confirm every challenge's reference solution actually
// passes its own hidden tests, using the real Pyodide runtime and the same check()
// harness the app runs in the browser.
//
// Run it with:  npm run validate:challenges
//
// This catches the worst kind of content bug — an "impossible" challenge whose
// tests disagree with its own solution — before it ever reaches your phone.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { loadChallenges } from '../server/src/challenges/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const challengesDir = path.join(__dirname, '..', 'challenges');

// Mirror of the worker's submit harness (worker.js). Kept in sync deliberately.
const HARNESS_PRELUDE = `
_pp_results = []
def check(cond, msg=""):
    _pp_results.append({"ok": bool(cond), "msg": str(msg)})
`;

const pyodide = await loadPyodide();

/** Run solution + tests exactly as the app would, returning pass/fail detail. */
function runSolution(code, tests) {
  const ns = pyodide.toPy({});
  let error;
  let results = [];
  try {
    pyodide.runPython(HARNESS_PRELUDE, { globals: ns });
    try {
      pyodide.runPython(code, { globals: ns });
    } catch (e) {
      error = String(e.message).trim().split('\n').pop();
    }
    if (!error) {
      try {
        pyodide.runPython(tests, { globals: ns });
      } catch (e) {
        error = String(e.message).trim().split('\n').pop();
      }
      const rp = ns.get('_pp_results');
      if (rp) {
        results = rp.toJs({ dict_converter: Object.fromEntries });
        rp.destroy();
      }
    }
  } finally {
    ns.destroy();
  }
  const passed = !error && results.length > 0 && results.every((r) => r.ok);
  return { passed, error, results };
}

const store = loadChallenges(challengesDir);
let failures = 0;

for (const c of store.all()) {
  const r = runSolution(c.solution, c.tests);
  if (!r.passed) failures++;
  const detail = r.passed
    ? ''
    : `  error=${r.error ?? ''} failed=${JSON.stringify(
        r.results.filter((x) => !x.ok).map((x) => x.msg),
      )}`;
  console.log(`${r.passed ? 'PASS' : 'FAIL'}  [d${c.difficulty}] ${c.id}  (${r.results.length} checks)${detail}`);
}

console.log(
  failures === 0
    ? `\n✓ All ${store.all().length} challenge solutions pass their own tests.`
    : `\n✗ ${failures} challenge(s) failed — fix before deploying.`,
);
process.exit(failures === 0 ? 0 : 1);
