// Routes for in-app challenge authoring (CRUD over user-authored challenges).
//
// Authored challenges are merged into the same store the rest of the app reads, so
// once created they behave exactly like a built-in challenge (list, open, run,
// solve, review). All the validation/id/rebuild policy lives in services/authoring.js
// so these handlers stay thin. Auth is applied to the whole plugin scope in app.js.

import {
  listAuthored,
  getAuthoredFull,
  createAuthored,
  updateAuthored,
  removeAuthored,
} from '../services/authoring.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function authoredRoutes(fastify) {
  const { db, store } = fastify;

  // List authored challenges (metadata) for the management screen.
  fastify.get('/api/authored', async () => {
    return listAuthored(db);
  });

  // The full stored challenge (incl. tests + solution) so the editor can load it.
  fastify.get('/api/authored/:id', async (request, reply) => {
    const full = getAuthoredFull(db, request.params.id);
    if (!full) return reply.code(404).send({ error: 'Authored challenge not found' });
    return full;
  });

  // Create.
  fastify.post('/api/authored', async (request, reply) => {
    const result = createAuthored(db, store, request.body, fastify.log);
    if (!result.ok) {
      return reply.code(result.status).send({ error: result.error, details: result.details });
    }
    return reply.code(201).send({ ok: true, challenge: result.challenge });
  });

  // Update (path id is authoritative).
  fastify.put('/api/authored/:id', async (request, reply) => {
    const result = updateAuthored(db, store, request.params.id, request.body, fastify.log);
    if (!result.ok) {
      return reply.code(result.status).send({ error: result.error, details: result.details });
    }
    return { ok: true, challenge: result.challenge };
  });

  // Delete (also removes the challenge's progress + review state).
  fastify.delete('/api/authored/:id', async (request, reply) => {
    const result = removeAuthored(db, store, request.params.id, fastify.log);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { ok: true };
  });
}
