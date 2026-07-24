# PyPocket

A self-hosted, mobile-first web app for practising Python. A browser code editor,
curated auto-graded challenges, hints, a reference solution, and streak tracking —
designed to use on your phone. Python runs entirely in the browser via Pyodide
(WebAssembly), so there's no server-side code execution to secure.

> **Status:** Phase 1. Single-user, password-gated, deployable as one Docker
> container. See [NOTES.md](./NOTES.md) for the design and [DEPLOY.md](./DEPLOY.md)
> for hosting on Coolify behind a Cloudflare tunnel.

## Features

- 📱 Mobile-first UI — tabs for Task / Code / Output, plus a symbol toolbar above the
  keyboard for the characters Python needs (`:` `(` `)` `[` `]` `_` …).
- 🐍 In-browser Python (Pyodide in a Web Worker) with a 10s timeout and a **Stop**
  button that reliably kills runaway loops.
- ✅ Auto-graded challenges with per-check pass/fail messages.
- 💡 Progressive hints and a locked reference solution.
- 🔥 Progress dashboard: daily streak, per-topic bars, "continue where you left off".
- 📦 Installable PWA — add to home screen, works offline after first load.

## Tech

React + Vite (client) · Fastify + better-sqlite3 (server) · Pyodide · CodeMirror 6 ·
plain JavaScript with JSDoc. Challenges are YAML files in [`challenges/`](./challenges).

## Quick start (development)

```bash
npm install                 # installs both workspaces
npm run dev:server          # terminal 1 — API on :3000
npm run dev:client          # terminal 2 — Vite dev server on :5173 (proxies /api)
# open http://localhost:5173  (dev password defaults to "dev")
```

## Quick start (production image)

```bash
APP_PASSWORD=yourpass \
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
docker compose up --build
# open http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Backend unit tests (auth, streak logic, challenge loader). |
| `npm run validate:challenges` | Runs every challenge's solution through real Pyodide to prove the tests pass. |
| `npm run build:client` | Copies the pinned Pyodide runtime and builds the SPA into `client/dist`. |
| `npm run dev:server` / `dev:client` | Development servers. |

## Project layout

```
challenges/    hand-authored YAML challenges (+ AUTHORING.md)
server/        Fastify API, SQLite, auth, challenge loader
client/        React PWA, CodeMirror editor, Pyodide worker
tools/         validate-challenges.mjs
Dockerfile     multi-stage build → single runtime container
```

## Writing your own challenges

See [`challenges/AUTHORING.md`](./challenges/AUTHORING.md). Add a YAML file, run
`npm run validate:challenges`, redeploy.

## Roadmap

- **Phase 2** — a sandboxed server-side runner (second container, internal network
  only) for challenges needing real packages, bigger programs, or genuinely hidden
  tests. The challenge schema already has a `runner: server` seam for it.
- **Phase 3** — in-app challenge authoring, spaced-repetition review, import/export
  progress as JSON.
