// Session + password helpers.
//
// The whole app is gated by a single password (there is no user table). When you
// log in we set a *signed* cookie. The signature is produced with SESSION_SECRET,
// so the cookie cannot be forged by anyone who doesn't know the secret — that's
// what makes it a valid proof of "this browser logged in".
//
// The cookie is stateless (no server-side session record). A happy side effect:
// you can log in on your phone AND your desktop at the same time and neither logs
// the other out — each browser just holds its own signed cookie. See NOTES.md.

import crypto from 'node:crypto';

export const SESSION_COOKIE = 'pp_session';

/**
 * Compare a submitted password against the configured one in constant time, so an
 * attacker can't learn the password from response timing.
 * @param {string} submitted
 * @param {string} expected
 * @returns {boolean}
 */
export function passwordMatches(submitted, expected) {
  // Hash both to fixed-length buffers first: timingSafeEqual requires equal lengths,
  // and hashing avoids leaking the password length through a length mismatch.
  const a = crypto.createHash('sha256').update(String(submitted)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Set the signed session cookie on a reply.
 * @param {import('fastify').FastifyReply} reply
 * @param {import('../config.js').config} config
 */
export function setSession(reply, config) {
  reply.setCookie(SESSION_COOKIE, 'authenticated', {
    path: '/',
    httpOnly: true, // not readable by JS — mitigates XSS token theft
    sameSite: 'lax', // sensible default; the app is same-origin
    secure: config.isProduction, // only sent over HTTPS in production (the tunnel)
    signed: true, // integrity-protected with SESSION_SECRET
    maxAge: config.sessionMaxAgeSeconds, // persistent: survives browser restarts
  });
}

/**
 * Clear the session cookie (logout).
 * @param {import('fastify').FastifyReply} reply
 */
export function clearSession(reply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * True if the request carries a valid, correctly-signed session cookie.
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function isAuthenticated(request) {
  const raw = request.cookies?.[SESSION_COOKIE];
  if (!raw) return false;
  // unsignCookie verifies the signature; .valid is false if tampered/forged.
  const result = request.unsignCookie(raw);
  return result.valid && result.value === 'authenticated';
}

/**
 * Fastify onRequest hook that rejects unauthenticated requests with 401. Applied to
 * the protected route group in index.js.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function requireAuth(request, reply) {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ error: 'Not authenticated' });
  }
}
