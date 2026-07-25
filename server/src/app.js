// Builds and wires up the Fastify application (but does not start listening).
//
// Keeping "build the app" separate from "listen on a port" lets the test suite
// create an app and use fastify.inject() to fire fake requests at it — no real
// network, no real port. index.js is the thin wrapper that actually listens.

import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';

import { config as defaultConfig } from './config.js';
import { openDatabase } from './db/db.js';
import { loadChallenges } from './challenges/loader.js';
import { requireAuth } from './auth/session.js';
import { makeRunner } from './runner/serverRunner.js';
import { authRoutes } from './auth/routes.js';
import { challengeRoutes } from './routes/challenges.js';
import { progressRoutes } from './routes/progress.js';
import { reviewRoutes } from './routes/reviews.js';
import { healthRoutes } from './routes/health.js';

/**
 * Decide the Cache-Control header for a static file by its path.
 *  - /assets/*  : content-hashed by Vite, so cache aggressively and immutably.
 *  - /pyodide/* : large, versioned runtime; cache a day (the service worker also
 *                 runtime-caches it), but let it revalidate so a version bump lands.
 *  - everything else (index.html, sw.js, *.webmanifest, workbox-*): must revalidate
 *    every time, otherwise a deployed update won't reach a device that has the old
 *    files cached.
 * @param {string} filePath Absolute path of the file being served.
 * @returns {string}
 */
function cacheControlFor(filePath) {
  const p = filePath.replace(/\\/g, '/'); // normalise Windows separators
  if (p.includes('/assets/')) return 'public, max-age=31536000, immutable';
  if (p.includes('/pyodide/')) return 'public, max-age=86400, must-revalidate';
  return 'no-cache';
}

/**
 * @param {Object} [overrides]
 * @param {typeof defaultConfig} [overrides.config]  Swap config (tests use temp paths/secrets).
 * @param {import('better-sqlite3').Database} [overrides.db]  Provide a db (tests use in-memory).
 * @param {import('./challenges/loader.js').ChallengeStore} [overrides.store]  Provide challenges.
 * @param {{run: Function}} [overrides.runner]  Server-side code runner (tests stub this).
 * @param {boolean} [overrides.serveClient]  Serve the built SPA (default: production only).
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(overrides = {}) {
  const config = overrides.config ?? defaultConfig;
  const db = overrides.db ?? openDatabase(config.dbPath);
  const store = overrides.store ?? loadChallenges(config.challengesDir);
  const runner = overrides.runner ?? makeRunner(config.runnerUrl);
  const serveClient = overrides.serveClient ?? config.isProduction;

  const fastify = Fastify({
    // Behind the Cloudflare tunnel Fastify sits behind a proxy; trustProxy makes
    // request.protocol / ip reflect the real client via X-Forwarded-* headers.
    trustProxy: true,
    logger: {
      level: config.isProduction ? 'info' : 'warn',
    },
  });

  // Make shared singletons available to every route as fastify.<name>.
  fastify.decorate('config', config);
  fastify.decorate('db', db);
  fastify.decorate('store', store);
  fastify.decorate('runner', runner);
  // Close the DB cleanly when the server stops.
  fastify.addHook('onClose', async () => db.close());

  // --- Security + parsing plugins -------------------------------------------
  await fastify.register(helmet, {
    // The SPA + Pyodide need a permissive-ish CSP. We self-host everything, so we
    // can keep it same-origin. 'wasm-unsafe-eval' is required to compile Pyodide's
    // WebAssembly; 'unsafe-inline' covers the small bootstrap styles.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    // We serve same-origin assets; the strict cross-origin isolation headers aren't
    // needed in Phase 1 (no SharedArrayBuffer), and leaving them off keeps things
    // simple behind the tunnel.
    crossOriginEmbedderPolicy: false,
  });

  await fastify.register(cookie, {
    secret: config.sessionSecret, // enables signed cookies
  });

  await fastify.register(rateLimit, {
    global: false, // opt-in per route; only login needs tight limits in Phase 1
    max: 100,
    timeWindow: '1 minute',
  });

  // --- Routes ----------------------------------------------------------------
  // Unauthenticated: health check + auth endpoints.
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);

  // Everything else requires a valid session. Registering the protected routes
  // inside their own plugin scope means the onRequest guard applies to all of them
  // and nothing else — a clean, hard-to-forget boundary.
  await fastify.register(async (protectedScope) => {
    protectedScope.addHook('onRequest', requireAuth);
    await protectedScope.register(challengeRoutes);
    await protectedScope.register(progressRoutes);
    await protectedScope.register(reviewRoutes);
  });

  // --- Serve the built client (production) -----------------------------------
  if (serveClient) {
    const clientDist = config.clientDist;
    if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
      fastify.log.warn(
        `Client build not found at ${clientDist}. Run "npm run build:client" first.`,
      );
    }
    await fastify.register(fastifyStatic, {
      root: clientDist,
      // Serve index.html for "/" (default). Deep links like /challenge/foo don't map
      // to a file, so they fall through to the SPA fallback below.
      //
      // Turn off the plugin's built-in Cache-Control (which otherwise forces
      // "public, max-age=0" on everything) so our own per-file policy wins:
      // fingerprinted build assets are cached forever (their filename changes when the
      // content does), but the files that decide whether a new deploy is picked up —
      // index.html, the service worker, the manifest — must be revalidated every
      // request, or a phone keeps running the old app.
      cacheControl: false,
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', cacheControlFor(filePath));
      },
    });

    // SPA fallback: any non-API GET that didn't match a file returns index.html so
    // client-side routing (e.g. /challenge/foo) works on a hard refresh. sendFile goes
    // through the same static config above, so index.html gets "no-cache" too.
    fastify.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not found' });
    });
  }

  return fastify;
}
