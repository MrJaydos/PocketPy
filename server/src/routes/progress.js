// Dashboard route: the aggregated numbers the Home screen shows (streak, totals,
// per-topic bars, and where to continue). All the real work is in
// services/progress.js so it can be tested without HTTP.

import { buildDashboard } from '../services/progress.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function progressRoutes(fastify) {
  fastify.get('/api/progress', async () => {
    return buildDashboard(fastify.db, fastify.store, fastify.config.appTz);
  });
}
