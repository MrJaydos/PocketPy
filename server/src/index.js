// Entry point: build the app and start listening. Kept tiny on purpose — all the
// interesting wiring is in app.js so tests can build the app without a real port.

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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
