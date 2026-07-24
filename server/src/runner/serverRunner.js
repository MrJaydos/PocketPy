// Client for the Phase 2 server-side runner service.
//
// This is the backend half of the ExecutionRunner seam (see interface.js): it POSTs
// the code (and, for a graded submit, the hidden tests) to the internal runner
// service and returns the result in the same shape the browser worker produces.
//
// The runner is only reachable on the private Docker network. If it's down or slow,
// we fail cleanly with a thrown error so the route can return a "runner unavailable"
// message instead of hanging.

/**
 * @param {string} runnerUrl Base URL of the runner service (e.g. http://runner:8000).
 * @param {{code: string, tests?: string}} input
 * @param {number} [timeoutMs] Overall request timeout (a bit longer than the runner's
 *   own execution timeout, so its timeout result wins over ours).
 * @returns {Promise<{stdout: string, stderr: string, results: Array<{ok:boolean,msg:string}>, passed: boolean, error: string|null, status: string}>}
 */
export async function runOnServer(runnerUrl, { code, tests = '' }, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${runnerUrl}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, tests }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Runner responded ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The default runner object decorated onto Fastify. Tests swap this for a stub so the
 * routes can be exercised without a live runner (or Docker/Python).
 * @param {string} runnerUrl
 */
export function makeRunner(runnerUrl) {
  return {
    /** @param {{code: string, tests?: string}} input */
    run: (input) => runOnServer(runnerUrl, input),
  };
}
