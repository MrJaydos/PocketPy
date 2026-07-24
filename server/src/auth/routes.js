// Login / logout / me routes.
//
// login is rate-limited hard (see index.js) because it's the one endpoint an
// attacker on the internet can hammer to guess the password.

import {
  passwordMatches,
  setSession,
  clearSession,
  isAuthenticated,
} from './session.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function authRoutes(fastify) {
  const { config } = fastify;

  // Exchange the password for a session cookie.
  fastify.post(
    '/api/auth/login',
    {
      // A tight per-endpoint rate limit. For a single shared password, a global
      // limiter is the right model: the goal is to slow brute-forcing of that one
      // password, and per-IP keys are meaningless behind the Cloudflare tunnel.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          // Same bucket for everyone -> a true global cap on login attempts.
          keyGenerator: () => 'global-login',
        },
      },
    },
    async (request, reply) => {
      const password = request.body?.password;
      if (typeof password !== 'string' || !passwordMatches(password, config.password)) {
        // Deliberately vague message; don't reveal whether the password was close.
        return reply.code(401).send({ error: 'Incorrect password' });
      }
      setSession(reply, config);
      return { ok: true };
    },
  );

  // Clear the cookie. Safe to call when already logged out.
  fastify.post('/api/auth/logout', async (request, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  // Lightweight check the client uses on load to decide login vs app.
  fastify.get('/api/auth/me', async (request) => {
    return { authenticated: isAuthenticated(request) };
  });
}
