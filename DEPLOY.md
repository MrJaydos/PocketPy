# DEPLOY — Coolify + Cloudflare tunnel

PocketPy ships as **one Docker container** on **one port** (serves the API and the
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

## Coolify setup (Docker Compose build pack)

This repo deploys via **`docker-compose.yaml`**, which builds the image from the
`Dockerfile` and wires everything up using Coolify's compose conventions. Most of the
config is in the compose file, so there's very little to click.

1. **New Resource → Application → from your Git repo** → set **Build Pack = "Docker
   Compose"**. Coolify auto-detects `docker-compose.yaml` at the repo root (if asked,
   Base Directory = `/`, Compose file = `/docker-compose.yaml`). Pushing to `main`
   triggers a rebuild + redeploy.
2. **Environment variables** (Coolify reads these from the compose file and shows
   editable fields):
   - `APP_PASSWORD` — **required**; deployment won't proceed until you set it. This is
     your login password.
   - `SESSION_SECRET` — **auto-generated** by Coolify (`SERVICE_PASSWORD_64_PYPOCKET`),
     stable across redeploys. Nothing to do; override in the UI if you like.
   - `APP_TZ` — optional, defaults to `UTC`. Set e.g. `Europe/London` so streak days
     roll over at your midnight.
   - `NODE_ENV`, `PORT`, `DB_PATH` are already set in the compose file.
3. **Persistent storage**: handled automatically — the compose file declares the
   `pypocket-data` named volume mounted at `/data`, which Coolify persists across
   deploys. (Your progress/streaks live there.)
4. **Domain / port**: the compose file's `SERVICE_FQDN_PYPOCKET_3000` tells Coolify to
   route the assigned domain to the container's port 3000 through its proxy. Assign the
   domain your Cloudflare tunnel points at.
5. **Health check**: the service declares one hitting `/healthz`; Coolify uses it.

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

## Local testing

The committed `docker-compose.yaml` uses Coolify's magic variables (`SERVICE_FQDN_…`,
`SERVICE_PASSWORD_64_…`) and `expose` rather than a published host port, so it's meant
for Coolify, not a plain local `docker compose up`. For local development just run the
app directly (no Docker needed):

```bash
npm install
npm run dev:server   # API on :3000
npm run dev:client   # Vite dev server on :5173 (proxies /api) — open this
```

If you specifically want to smoke-test the built container locally, build the image and
run it with a published port and env vars:

```bash
docker build -t pypocket .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production -e APP_PASSWORD=testpass \
  -e SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  -e DB_PATH=/data/app.db -v pypocket-data:/data \
  pypocket
# open http://localhost:3000
```

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
