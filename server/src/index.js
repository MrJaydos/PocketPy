// Entry point: build the app and start listening. Kept tiny on purpose — all the
// interesting wiring is in app.js so tests can build the app without a real port.

import crypto from 'node:crypto';
import { buildApp } from './app.js';
import { config } from './config.js';

async function main() {
  const app = await buildApp();

  // Graceful shutdown so SQLite's WAL is checkpointed and the container exits clean.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down.`);
      await app.close();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`PyPocket listening on http://${config.host}:${config.port}`);
    // Diagnostic (never logs the value): if login fails despite entering the right
    // password, the stored value isn't what you think. Compare `length` to your
    // password's length, and `fp` (a truncated SHA-256 fingerprint) to what you get
    // locally from:
    //   node -e "console.log(require('crypto').createHash('sha256').update('YOURPASS').digest('hex').slice(0,10))"
    // A matching fp proves the server has exactly your password; a mismatch means the
    // env value is wrong (whitespace, a $ eaten by compose, a #, quotes, ...).
    const fp = crypto.createHash('sha256').update(config.password).digest('hex').slice(0, 10);
    app.log.info(`Auth ready: APP_PASSWORD length = ${config.password.length}, fp = ${fp}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
