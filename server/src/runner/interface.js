// Execution-runner seam (designed in Phase 1, fully used in Phase 2).
//
// Phase 1 runs all Python client-side in a Pyodide Web Worker, so the server does
// not execute code at all. But challenges carry a `runner` field ("pyodide" |
// "server"), and Phase 2 will add a sandboxed server-side runner as a *second*
// container for challenges that need real packages or genuinely hidden tests.
//
// To make that future drop-in clean, we define the interface both runners will
// share here, and provide a stub for the server one. Route code can then ask
// `selectRunner(challenge.runner)` and treat the result uniformly.

/**
 * @typedef {Object} RunResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {Array<{ok: boolean, msg: string}>} results  Per-assertion outcomes.
 * @property {boolean} passed   True if every assertion passed.
 * @property {string} [error]   Set if the user's code errored before tests ran.
 */

/**
 * @typedef {Object} ExecutionRunner
 * @property {string} name
 * @property {(code: string, tests: string) => Promise<RunResult>} test
 */

/**
 * The Pyodide runner has no server-side implementation: the browser owns it. We
 * expose a marker so routing logic can be explicit that "pyodide" means
 * "the client already ran this; the server just records the outcome."
 * @type {{name: string, clientSide: true}}
 */
export const pyodideRunner = { name: 'pyodide', clientSide: true };

/**
 * Choose a runner for a challenge's `runner` field.
 * @param {'pyodide'|'server'} kind
 */
export function selectRunner(kind) {
  if (kind === 'server') {
    // Phase 2 will return a real client that talks to the internal runner service.
    throw new Error('Server-side runner is not available in Phase 1.');
  }
  return pyodideRunner;
}
