// Challenge + progress routes.
//
// These are the endpoints the challenge screen talks to: list challenges, fetch one
// (with its tests but not its solution), autosave a draft, record attempts/solves,
// reveal hints, and reveal the solution. All of them require the auth cookie — that
// guard is applied once for the whole plugin in index.js.

import {
  getProgress,
  getAllProgress,
  recordAttempt,
  recordHintUsed,
  markSolutionViewed,
  saveDraft,
} from '../db/progressRepo.js';
import { recordSolve } from '../services/progress.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function challengeRoutes(fastify) {
  const { store, db } = fastify;

  // List: metadata for every challenge, merged with the user's status/hints-used so
  // the list screen can show ticks and progress without N extra requests.
  fastify.get('/api/challenges', async () => {
    const progress = getAllProgress(db);
    return store.list().map((c) => {
      const row = progress.get(c.id);
      return {
        ...c,
        status: row?.status ?? 'not_started',
        hintsUsed: row?.hints_used ?? 0,
        solutionViewed: Boolean(row?.solution_viewed),
      };
    });
  });

  // One challenge: everything needed to render + run it (includes tests, excludes
  // solution), plus the saved draft and progress so the editor restores state.
  fastify.get('/api/challenges/:id', async (request, reply) => {
    const full = store.full(request.params.id);
    if (!full) return reply.code(404).send({ error: 'Challenge not found' });

    const row = getProgress(db, request.params.id);
    return {
      ...full,
      status: row?.status ?? 'not_started',
      hintsUsed: row?.hints_used ?? 0,
      solutionViewed: Boolean(row?.solution_viewed),
      draftCode: row?.draft_code ?? null,
    };
  });

  // Autosave the user's in-progress code. PUT because it's an idempotent replace.
  fastify.put('/api/challenges/:id/draft', async (request, reply) => {
    if (!store.get(request.params.id)) {
      return reply.code(404).send({ error: 'Challenge not found' });
    }
    const code = typeof request.body?.code === 'string' ? request.body.code : '';
    saveDraft(db, request.params.id, code);
    return { ok: true };
  });

  // Record a submission attempt (the client calls this whenever it runs the tests).
  fastify.post('/api/challenges/:id/attempt', async (request, reply) => {
    if (!store.get(request.params.id)) {
      return reply.code(404).send({ error: 'Challenge not found' });
    }
    const row = recordAttempt(db, request.params.id);
    return { attempts: row.attempts };
  });

  // Mark solved. Phase 1 trusts the client's report that all tests passed (code runs
  // in the browser, so there is no server-side re-check yet — see NOTES.md). Updates
  // the daily streak.
  fastify.post('/api/challenges/:id/solve', async (request, reply) => {
    if (!store.get(request.params.id)) {
      return reply.code(404).send({ error: 'Challenge not found' });
    }
    const { current, longest, firstSolve } = recordSolve(
      db,
      request.params.id,
      fastify.config.appTz,
    );
    return { ok: true, firstSolve, streak: { current, longest } };
  });

  // Reveal a single hint by index. Revealing is tracked (hints_used = max index+1).
  fastify.post('/api/challenges/:id/hint', async (request, reply) => {
    const id = request.params.id;
    if (!store.get(id)) return reply.code(404).send({ error: 'Challenge not found' });

    const index = Number(request.body?.index);
    const text = store.hint(id, index);
    if (text === undefined) {
      return reply.code(400).send({ error: 'No hint at that index' });
    }
    recordHintUsed(db, id, index + 1);
    return { index, hint: text };
  });

  // Reveal the reference solution. Allowed once the challenge is solved, or when the
  // client explicitly signals "give up" (?giveUp=1 / body.giveUp). This is the one
  // place the solution field ever leaves the server.
  fastify.post('/api/challenges/:id/reveal-solution', async (request, reply) => {
    const id = request.params.id;
    if (!store.get(id)) return reply.code(404).send({ error: 'Challenge not found' });

    const row = getProgress(db, id);
    const solved = row?.status === 'solved';
    const giveUp = request.body?.giveUp === true;
    if (!solved && !giveUp) {
      return reply
        .code(403)
        .send({ error: 'Solution is locked until you solve the challenge or give up.' });
    }

    markSolutionViewed(db, id);
    return { solution: store.solution(id) };
  });

  // --- Phase 2: server-side runner (challenges flagged `runner: "server"`) -------
  // These run in the sandboxed runner container instead of Pyodide. The hidden tests
  // never reach the browser, and grading is authoritative — decided here from the
  // real result, not trusted from the client.

  /** Look up a challenge and ensure it's a server-run one, else send an error. */
  function requireServerChallenge(id, reply) {
    const ch = store.get(id);
    if (!ch) {
      reply.code(404).send({ error: 'Challenge not found' });
      return null;
    }
    if (ch.runner !== 'server') {
      reply.code(400).send({ error: 'Not a server-run challenge' });
      return null;
    }
    return ch;
  }

  // Tight-ish limit on the exec endpoints (they're the untrusted-code entry point).
  const runnerRate = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  // Plain Run: execute the code and return its output. No tests, no grading.
  fastify.post('/api/challenges/:id/run-server', runnerRate, async (request, reply) => {
    const ch = requireServerChallenge(request.params.id, reply);
    if (!ch) return reply;
    try {
      return await fastify.runner.run({ code: request.body?.code ?? '', tests: '' });
    } catch (err) {
      request.log.error(err, 'server runner failed');
      return reply
        .code(502)
        .send({ status: 'runner_error', error: 'The runner is unavailable. Try again in a moment.' });
    }
  });

  // Graded Submit: run the hidden tests on the server and record the outcome.
  fastify.post('/api/challenges/:id/submit-server', runnerRate, async (request, reply) => {
    const ch = requireServerChallenge(request.params.id, reply);
    if (!ch) return reply;

    recordAttempt(db, ch.id);
    let result;
    try {
      result = await fastify.runner.run({ code: request.body?.code ?? '', tests: ch.tests });
    } catch (err) {
      request.log.error(err, 'server runner failed');
      return reply
        .code(502)
        .send({ status: 'runner_error', error: 'The runner is unavailable. Try again in a moment.' });
    }

    // Authoritative grading: we ran the real tests, so we can trust the outcome.
    let streak = null;
    if (result.status === 'ok' && result.passed) {
      const r = recordSolve(db, ch.id, fastify.config.appTz);
      streak = { current: r.current, longest: r.longest };
    }
    return { ...result, streak };
  });
}
