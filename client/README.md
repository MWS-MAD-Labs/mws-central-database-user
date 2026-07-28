# MWS Data Center Client

React + Vite admin dashboard for MWS Data Center.

## Local Dev

```bash
bun install
bun run dev
```

The dev server runs on `http://localhost:5173` and proxies `/api` to
`http://localhost:3000` by default. Override it with:

```bash
VITE_API_PROXY_TARGET=http://localhost:3010 bun run dev
```

## Docker

From the repo root:

```bash
docker compose up -d --build client
```

The container serves the built app with Nginx on `http://localhost:5173`.
Change the host port with `CLIENT_HTTP_PORT`.

Runtime public env is written to `/env.js` when the container starts:

```bash
VITE_API_BASE_URL=
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173
```

Put those values in `client/.env`; `docker-compose.yml` reads that file with
`env_file`.

Leave `VITE_API_BASE_URL` empty when using Docker Compose so Nginx can proxy
same-origin `/api` requests to the `server` service.
