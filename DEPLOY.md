# DEPLOY — Coolify + Cloudflare tunnel

PyPocket ships as **one Docker container** on **one port** (serves the API and the
built app). Data is a single SQLite file on a mounted volume.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `APP_PASSWORD` | **yes** (prod) | The single password that gates the app. Use a long passphrase. |
| `SESSION_SECRET` | **yes** (prod) | Secret used to sign the session cookie. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DB_PATH` | recommended | Path to the SQLite file. Set to `/data/app.db` so it lands on the mounted volume. |
| `APP_TZ` | recommended | IANA timezone (e.g. `Europe/London`) used to decide which day a solve counts toward for the streak. Defaults to `UTC`. |
| `PORT` | optional | Port to listen on. Defaults to `3000`. |
| `NODE_ENV` | set to `production` | Enables the `Secure` cookie flag and the production CSP. |

In production the server **refuses to start** without `APP_PASSWORD` and
`SESSION_SECRET`, so a misconfigured deploy fails loudly instead of running insecure.

## Coolify setup

1. **New Resource → Application → from your Git repo** (this repo). Coolify detects
   the `Dockerfile` and builds it. Pushing to `main` triggers a rebuild + redeploy.
2. **Persistent storage**: add a volume mounted at **`/data`**. This is where
   `app.db` lives; without it your progress resets on every redeploy.
3. **Environment variables**: set `APP_PASSWORD`, `SESSION_SECRET`, `DB_PATH=/data/app.db`,
   `APP_TZ`, and `NODE_ENV=production`.
4. **Port**: the container listens on `3000` (or `$PORT`). Point Coolify's proxy at it.
5. **Health check**: path **`/healthz`** (the image also declares a Docker
   `HEALTHCHECK`).
6. **Domain**: assign the domain that your Cloudflare tunnel points at.

## Cloudflare tunnel notes

- **Plain HTTPS is all Phase 1 needs** — there are no WebSockets or server-sent
  events, because code runs in the browser. Nothing special to enable.
- The app sits behind Cloudflare's proxy, so Fastify runs with `trustProxy: true`
  and sets the session cookie `Secure` in production (HTTPS only). Make sure the
  tunnel serves the app over **HTTPS** (it does by default) or the cookie won't stick.
- **Pyodide is self-hosted** (served from your own origin at `/pyodide/…`), so there
  are no third-party CDN hosts to allow. The service worker caches it for offline use.
- First load downloads ~13 MB of Pyodide runtime (once, then cached). Subsequent
  loads and offline use are instant.

## Local test of the production image

Before pushing, you can run exactly what Coolify runs:

```bash
APP_PASSWORD=testpass \
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
docker compose up --build
# open http://localhost:3000
```

The `pypocket-data` named volume keeps your data across rebuilds.

## Pre-deploy checks

```bash
npm test                    # backend unit tests (auth, streaks, challenge loader)
npm run validate:challenges # every challenge's solution passes its own tests
npm run build:client        # the client builds cleanly
```

## Backups

The entire app state is one file. Back it up by copying `app.db` off the `/data`
volume (Coolify can also snapshot the volume). To reset all progress, stop the app
and delete `app.db`; it's recreated empty on next boot.
