// Health-check route for Coolify. Kept dead simple and unauthenticated so the
// platform can poll it without a session. It also does a trivial DB read so a
// broken database surfaces as an unhealthy container rather than a silent 200.

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function healthRoutes(fastify) {
  fastify.get('/healthz', async (request, reply) => {
    try {
      // Cheap liveness probe of the SQLite connection.
      fastify.db.prepare('SELECT 1').get();
      return { status: 'ok', challenges: fastify.store.all().length };
    } catch (err) {
      request.log.error(err, 'health check failed');
      reply.code(503);
      return { status: 'error' };
    }
  });
}
