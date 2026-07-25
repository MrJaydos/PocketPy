// Import/export routes: download your whole dataset as one JSON file, or restore it.
//
// Export is a plain GET that streams the versioned envelope with a Content-Disposition
// so the browser saves it as a file. Import takes the uploaded envelope as the request
// body and a ?mode=merge|replace query; after applying it we rebuild the challenge
// registry because authored challenges may have changed. All the validation and the
// atomic write live in services/dataTransfer.js. Auth covers the whole scope (app.js).

import { exportData, importData } from '../services/dataTransfer.js';
import { loadAuthored } from '../challenges/authored.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function dataRoutes(fastify) {
  const { db, store } = fastify;

  // Download everything as a timestamped JSON file.
  fastify.get('/api/data/export', async (request, reply) => {
    const envelope = exportData(db);
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="pypocket-backup-${stamp}.json"`);
    reply.type('application/json');
    return envelope;
  });

  // Restore from an uploaded envelope. ?mode=replace wipes existing state first;
  // the default (merge) upserts on top of what's already there.
  fastify.post('/api/data/import', async (request, reply) => {
    const mode = request.query?.mode === 'replace' ? 'replace' : 'merge';
    const result = importData(db, request.body, mode);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });

    // Authored challenges may have been added/removed — refresh the live store.
    store.rebuild(loadAuthored(db, fastify.log));
    return { ok: true, mode: result.mode, summary: result.summary };
  });
}
