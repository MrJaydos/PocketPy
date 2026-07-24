// Copies the core Pyodide runtime out of the installed npm package into
// public/pyodide/ so we can serve it *same-origin* from our own backend.
//
// Why self-host instead of a CDN? Two reasons the plan settled on:
//  1. Offline / add-to-home-screen works reliably — the service worker precaches
//     same-origin files without the opaque-response quirks CDN URLs bring.
//  2. The runtime version is pinned to exactly what we installed, so an upstream
//     CDN change can never surprise the app.
//
// We copy only the five files needed to run pure-Python (stdlib) code — not the
// hundreds of optional package wheels — so the deployed image stays ~13 MB.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the installed pyodide package directory via its package.json.
const pyodidePkgJson = require.resolve('pyodide/package.json');
const pyodideDir = path.dirname(pyodidePkgJson);
const version = JSON.parse(fs.readFileSync(pyodidePkgJson, 'utf8')).version;

const destDir = path.join(__dirname, '..', 'public', 'pyodide');

// The minimal set the ESM loader needs to initialise and run stdlib Python.
const CORE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

const versionMarker = path.join(destDir, '.version');

// Idempotent: skip the copy if we already have this exact version in place. This
// keeps `npm run build` fast on repeat runs and in Docker layer caching.
if (
  fs.existsSync(versionMarker) &&
  fs.readFileSync(versionMarker, 'utf8').trim() === version &&
  CORE_FILES.every((f) => fs.existsSync(path.join(destDir, f)))
) {
  console.log(`Pyodide ${version} already present in public/pyodide — skipping copy.`);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
for (const file of CORE_FILES) {
  const src = path.join(pyodideDir, file);
  if (!fs.existsSync(src)) {
    console.error(`Expected Pyodide file not found: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(destDir, file));
}
fs.writeFileSync(versionMarker, version);

console.log(`Copied Pyodide ${version} core files into public/pyodide.`);
