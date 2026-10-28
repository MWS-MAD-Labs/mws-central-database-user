# Dev ports

Every app has its own ports on a developer machine, so all of them can run at the same time. A web port is strict: the
dev server stops when it is taken, it never moves to the next free one. A moved port is what sends a Hub card to the
wrong app, or a proxy to another app's backend.

| App | Web (Vite) | API | Where it is set |
| --- | --- | --- | --- |
| Central | 5173 | 3000 | `client/vite.config.js`, `server/.env` `PORT` |
| Exima | 3001 (Next.js, UI and API) | same | `package.json` `dev` script |
| Daily Check-in | 5174 | 3003 | `frontend/vite.config.js`, `.env` `PORT` |
| MTSS | 5176 | 3004 | `frontend/vite.config.js`, `backend/.env` `PORT` |
| Hub | 5175 | 4001 | `frontend/vite.config.ts`, `backend/.env` `PORT` |
| Woko | 5177 | 3011 | `.env` `WEB_ORIGIN` and `PORT` |
| Learnspace | 5178 | 4002 (Docker Compose publishes 4000) | `apps/web/vite.config.ts`, `.env` `PORT` |

Rules:

- A web app takes its port from one place and the proxy to its API from one place (`VITE_API_PROXY_TARGET`, or the
  API's own `PORT`). No number written twice.
- A new app takes the next free web port after 5178 and an API port that is not in the table. Add it here in the same
  commit.
- The address a Hub card opens is the web port above, set in Central (Application Access, launch address). After a port
  changes, change the card's address too.
- `APP_BASE_URL` in an app's `.env` is its own web address with this port. `mws-access doctor` checks that the app
  answers there.
