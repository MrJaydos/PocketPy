// Pyodide Web Worker.
//
// All Python runs here, off the main thread, so the UI never freezes — even during
// the multi-second Pyodide startup or a heavy computation. The main thread talks to
// this worker with messages and, crucially, KILLS it with worker.terminate() to stop
// a runaway loop (there is no other reliable way to interrupt synchronous WASM).
//
// Message protocol
//   main → worker: { type: 'warmup' }
//                  { type: 'run',    id, code }
//                  { type: 'submit', id, code, tests }
//   worker → main: { type: 'ready' }                        // Pyodide finished loading
//                  { type: 'result', id, ...payload }       // a run/submit finished
//
// The `id` lets the main thread ignore stale results from a worker it already gave
// up on (see usePyodide.js).

// Pyodide is served same-origin from /pyodide/. We import it at runtime (not via the
// bundler) so Vite leaves the path alone and the browser fetches our self-hosted copy.
const PYODIDE_URL = '/pyodide/pyodide.mjs';

/** @type {Promise<any> | null} Shared load promise so we only initialise once. */
let loadPromise = null;

/** Load Pyodide once and announce readiness. Safe to call repeatedly. */
function ensurePyodide() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_URL);
      const pyodide = await loadPyodide({ indexURL: '/pyodide/' });
      self.postMessage({ type: 'ready' });
      return pyodide;
    })();
  }
  return loadPromise;
}

// The Python harness injected before a challenge's hidden tests. It defines check(),
// which records each assertion's outcome instead of aborting on the first failure —
// that's what lets the UI show "3 of 4 passed" with a message per line.
const HARNESS_PRELUDE = `
_pp_results = []
def check(cond, msg=""):
    _pp_results.append({"ok": bool(cond), "msg": str(msg)})
`;

/**
 * Turn a Pyodide PythonError message (a full traceback) into a short, friendly
 * one-liner like "NameError: name 'shift' is not defined".
 * @param {string} message
 */
function friendlyError(message) {
  const lines = String(message).trim().split('\n');
  return lines[lines.length - 1] || 'Your code raised an error.';
}

/**
 * Run a block of Python in a fresh namespace, capturing stdout/stderr.
 * @param {any} pyodide
 * @param {string} code
 * @returns {{stdout: string, stderr: string, error?: string}}
 */
function runOnce(pyodide, code) {
  const stdout = [];
  const stderr = [];
  pyodide.setStdout({ batched: (s) => stdout.push(s) });
  pyodide.setStderr({ batched: (s) => stderr.push(s) });

  // A brand-new dict per run means no variables leak between runs.
  const namespace = pyodide.toPy({});
  try {
    pyodide.runPython(code, { globals: namespace });
    return { stdout: stdout.join(''), stderr: stderr.join('') };
  } catch (err) {
    return {
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      error: friendlyError(err?.message ?? String(err)),
    };
  } finally {
    namespace.destroy();
  }
}

/**
 * Run the user's code, then the hidden tests, in one shared namespace. Distinguishes
 * "your code errored before tests ran" from "some tests failed".
 * @param {any} pyodide
 * @param {string} code
 * @param {string} tests
 */
function submitOnce(pyodide, code, tests) {
  const stdout = [];
  const stderr = [];
  pyodide.setStdout({ batched: (s) => stdout.push(s) });
  pyodide.setStderr({ batched: (s) => stderr.push(s) });

  const namespace = pyodide.toPy({});
  let error;
  /** @type {Array<{ok: boolean, msg: string}>} */
  let results = [];

  try {
    // 1. Set up the harness (defines check + _pp_results).
    pyodide.runPython(HARNESS_PRELUDE, { globals: namespace });

    // 2. Run the user's code. A failure here means their code is broken, not that a
    //    test failed — report it as an error.
    try {
      pyodide.runPython(code, { globals: namespace });
    } catch (err) {
      error = friendlyError(err?.message ?? String(err));
    }

    // 3. Only run the tests if the user's code loaded cleanly. If a test itself
    //    throws (e.g. it calls a function the user never defined), surface that as
    //    an error too, keeping any results collected so far.
    if (!error) {
      try {
        pyodide.runPython(tests, { globals: namespace });
      } catch (err) {
        error = friendlyError(err?.message ?? String(err));
      }
      const resultsPy = namespace.get('_pp_results');
      if (resultsPy) {
        results = resultsPy.toJs({ dict_converter: Object.fromEntries });
        resultsPy.destroy();
      }
    }
  } finally {
    namespace.destroy();
  }

  // "Passed" requires that at least one assertion ran, they all passed, and the code
  // didn't error. The length check guards the vacuous every([]) === true trap, which
  // would otherwise mark a challenge solved when nothing actually ran.
  const passed = !error && results.length > 0 && results.every((r) => r.ok);

  return { stdout: stdout.join(''), stderr: stderr.join(''), results, passed, error };
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'warmup') {
    ensurePyodide();
    return;
  }

  const pyodide = await ensurePyodide();

  if (msg.type === 'run') {
    const payload = runOnce(pyodide, msg.code);
    self.postMessage({ type: 'result', id: msg.id, ...payload });
  } else if (msg.type === 'submit') {
    const payload = submitOnce(pyodide, msg.code, msg.tests);
    self.postMessage({ type: 'result', id: msg.id, ...payload });
  }
};
