# NOTES — architecture decisions & gotchas

Written for a JS/Python learner. This explains *why* things are the way they are,
and the non-obvious traps hit along the way. Phase 1 only.

## The big picture

One Node process (Fastify) does two jobs: it serves the JSON API **and** the built
React app, on a single port. Python never runs on the server in Phase 1 — it runs in
the browser via **Pyodide** (CPython compiled to WebAssembly) inside a **Web Worker**.
The database (SQLite, one file) only stores your *progress*; the challenges themselves
are YAML files in `challenges/`.

```
Phone browser (React PWA)
  ├─ CodeMirror editor + symbol toolbar
  ├─ Pyodide Web Worker ── runs your code + the hidden tests
  └─ fetch() with a session cookie ─► Fastify ─► SQLite (/data/app.db)
```

## Why these choices

- **Fastify over Express** — built-in schema validation, a clean plugin system
  (we use it to apply the auth guard to a whole group of routes at once), and
  first-class async. See `server/src/app.js`.
- **better-sqlite3 over Prisma** — its API is *synchronous*, so the data code reads
  top to bottom with no `await` noise. Plain SQL is also a nice thing to learn. See
  `server/src/db/`.
- **Plain JS + JSDoc, not TypeScript** — you asked to sharpen JS, and this keeps the
  toolchain simple. The JSDoc comments still give you editor autocomplete.
- **YAML challenges** — multi-line Python and Markdown are painless to hand-write
  with block scalars (`|`). See `challenges/AUTHORING.md`.

## Authentication: stateless signed cookie

Login checks one password (from `APP_PASSWORD`) and sets a **signed** cookie. The
signature uses `SESSION_SECRET`, so the cookie can't be forged without the secret.
There is no server-side session table.

A deliberate consequence: **you can be logged in on your phone and your desktop at
the same time**, and logging in on one doesn't log the other out — each browser just
holds its own signed cookie. The cookie is persistent (30 days), so you stay logged
in across restarts and after "add to home screen". Code: `server/src/auth/`.

## The Pyodide worker (the tricky part)

File: `client/src/pyodide/worker.js` + the hook `usePyodide.js`.

- **Why a Web Worker?** Pyodide runs *synchronously*. On the main thread a long loop
  would freeze the whole UI (and the Cancel button with it). In a worker, the UI
  stays live.
- **Cancelling a runaway loop = `worker.terminate()`.** Because execution is
  synchronous WASM, there is no "please stop" message it would check — the only
  reliable kill is to destroy the worker. On cancel/timeout we terminate it and
  **immediately spawn a fresh worker that starts warming up in the background** (the
  "warm spare"), so your next Run isn't stuck behind a cold ~2s Pyodide init.
- **10s timeout** — a main-thread timer; if a run exceeds it, same terminate+respawn.
- **Stale results** — a worker we gave up on might still post a result a moment later.
  Every request has an `id`; results for an already-settled id are ignored.
- **The `check()` harness** — instead of raw `assert` (which aborts on the first
  failure), the worker injects a tiny `check(cond, msg)` that *records* each result.
  That's how the UI can show "3 of 4 passed" with a message per line.
- **"Passed" is guarded** — a challenge is only marked solved if at least one check
  ran AND all passed AND the code didn't error. Without the "at least one" guard, a
  tests block that threw immediately (zero checks) would pass a vacuous `every([])`
  and falsely mark the challenge solved. See `submitOnce()` in `worker.js`.
- **Code-error vs test-failure** — if your code has a syntax/name error, the UI says
  *"Your code has an error: …"* rather than a misleading *0/N passed*.

You can validate all of the above headlessly (no browser) with:
`npm run validate:challenges` — it runs every challenge's solution through real
Pyodide and confirms the tests pass.

## Known limitations (honest list)

1. **Hidden tests aren't cryptographically hidden.** Since tests run in the browser,
   their text is delivered to the client and is visible in devtools. The *solution*
   is still gated server-side (sent only after you solve or give up). Truly hidden
   tests are a Phase 2 (server runner) feature.
2. **A memory bomb can crash the browser tab.** Something like `x = "a" * 10**12`
   allocates gigabytes inside the WASM heap almost instantly — faster than the 10s
   timer can fire — and the OS may kill the tab (and the PWA) before Python raises
   `MemoryError`. There's no clean cap on Pyodide's heap in Phase 1. Execution here
   is *isolated from the server*, but it is **not** a hardened sandbox. The Phase 2
   server runner is where real resource limits live.
3. **`input()` isn't supported.** It needs synchronous blocking
   (SharedArrayBuffer + cross-origin isolation), which we skipped. Challenges are
   function-based (graded by return value) instead — which is better for testing
   anyway.

## Gotchas worth remembering

- **YAML + colons.** A hint or line containing `": "` (colon-space) is read by YAML
  as a key/value map. Quote such strings. The loader's validation caught exactly this
  bug during development — see the quoted hint in `challenges/01-syntax-variables/010-greet.yaml`.
- **Pyodide versioning.** Upstream moved to a new scheme (this project pins
  `pyodide@314.0.3`). We **self-host** the ~13 MB of core runtime files by copying
  them out of the npm package (`client/scripts/copy-pyodide.mjs`) rather than trusting
  a CDN URL layout. The service worker runtime-caches them (CacheFirst) so they're
  fetched once and then work offline.
- **`@fastify/static` and `/`.** With `index` disabled it returns **403** for the
  directory root instead of falling through to the SPA fallback. We let it serve
  `index.html` for `/` and use the not-found handler only for deep links.
- **CSP is only real in production.** In `vite dev` the client is served by Vite with
  no helmet CSP, so Pyodide always loads there. The strict CSP in `app.js` only
  applies to the *built* app served by Node. Always verify Pyodide against the built
  app (see the checklist below), not just the dev server.
- **better-sqlite3 is a native module.** The Docker build installs `python3/make/g++`
  as a fallback and uses a Debian (glibc) base so the prebuilt binary works. An Alpine
  (musl) base would force a source compile.

## Manual on-device test checklist

Some things can only be verified in a real browser. After deploying (or via
`docker compose up`), on your phone:

1. Log in with `APP_PASSWORD`.
2. Open a challenge → **Code** tab → type `print("hi")` → **Run**. Output shows `hi`.
   (Open devtools/remote console once to confirm **no CSP violations** on first load.)
3. Type `while True: pass` → **Run** → tap **Stop**. UI recovers; the next Run is fast
   (warm spare working).
4. **Submit** a correct solution → see all checks pass and a "Solved 🎉" toast; the
   streak on Home goes up.
5. **Submit** a wrong solution → see which checks failed with messages.
6. Reveal a hint, then the solution (after solving). Reload — hints persist.
7. "Add to home screen", then turn on airplane mode and reopen — the app shell and
   Pyodide load from cache.
