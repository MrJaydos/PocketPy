// Opens (and lazily creates) the SQLite database, runs migrations, and hands back
// a ready-to-use better-sqlite3 connection.
//
// Why better-sqlite3? Its API is *synchronous*. For a tiny single-user app that is
// a feature, not a bug: queries return values directly instead of Promises, so the
// data-access code reads top-to-bottom with no async ceremony. SQLite itself is a
// single file on disk, which is trivial to back up and volume-mount in Coolify.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create a database connection at `dbPath`, ensuring the parent directory exists
 * and the schema has been applied.
 * @param {string} dbPath Absolute path to the .db file.
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(dbPath) {
  // Make sure the folder exists (e.g. ./data or /data) before SQLite tries to
  // create the file inside it.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // WAL mode gives us better concurrency and durability with almost no downside
  // for our workload; foreign_keys is on for correctness even though we don't use
  // many relations yet.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  return db;
}

/**
 * Apply the schema. Safe to call on every boot because schema.sql uses
 * CREATE TABLE IF NOT EXISTS.
 * @param {import('better-sqlite3').Database} db
 */
export function migrate(db) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  // Record the schema version so a future migration can branch on it.
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', '1')
     ON CONFLICT(key) DO NOTHING`,
  ).run();
}
