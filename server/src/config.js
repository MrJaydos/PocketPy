// Central place where we read and sanity-check environment variables.
//
// We read from process.env once, at startup, and export a plain object. Doing it
// here (rather than sprinkling process.env everywhere) means there is a single
// list of every setting the app understands, and we can fail fast with a clear
// message if something required is missing.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo root relative to this file so default paths work no matter
// which directory the process is started from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Read a required env var, or throw a helpful error if it is missing/blank.
 * @param {string} name
 * @returns {string}
 */
function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in (see DEPLOY.md).`,
    );
  }
  return value;
}

export const config = {
  isProduction,

  // Network
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  // Auth. In production we insist on real secrets; in development we fall back to
  // obvious placeholders so you can start the server without a .env file.
  //
  // We .trim() both: pasting a value into a hosting UI (Coolify, etc.) very commonly
  // picks up a trailing newline or stray spaces, which would otherwise become part of
  // the password and make every "correct" login fail with no obvious reason.
  password: (isProduction ? required('APP_PASSWORD') : process.env.APP_PASSWORD ?? 'dev').trim(),
  sessionSecret: (isProduction
    ? required('SESSION_SECRET')
    : process.env.SESSION_SECRET ?? 'dev-session-secret-not-for-production-use-only'
  ).trim(),

  // Storage
  dbPath: process.env.DB_PATH ?? path.join(repoRoot, 'data', 'app.db'),

  // Timezone used to bucket solves into calendar days for the streak.
  appTz: process.env.APP_TZ ?? 'UTC',

  // Phase 2 server-side runner. Defaults to the internal compose service name; the
  // app reaches it only on the private Docker network, never through the tunnel.
  runnerUrl: process.env.RUNNER_URL ?? 'http://runner:8000',

  // Where the hand-authored challenge YAML files live.
  challengesDir: process.env.CHALLENGES_DIR ?? path.join(repoRoot, 'challenges'),

  // Where the built client lives (only used in production; in dev Vite serves it).
  clientDist: process.env.CLIENT_DIST ?? path.join(repoRoot, 'client', 'dist'),

  // How long a login session cookie stays valid.
  sessionMaxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
};
