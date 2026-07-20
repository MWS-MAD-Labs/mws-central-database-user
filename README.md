# MWS Data Center

Centralized user database for MWS a single source of truth for Employee and
Student data, shared with other internal apps (Daily Check-in, MTSS, Reading
Buddy, Exima) through a scoped, token-based internal API. Admin panel access
and internal-API access both flow through one identity system, with every
sensitive read/write recorded to an audit log.

## Tech Stack

### Backend (`/server`) implemented

| Layer      | Tool                                           |
| ---------- | ---------------------------------------------- |
| Runtime    | Bun                                            |
| Framework  | Hono                                           |
| ORM        | Prisma + `@prisma/adapter-pg`                  |
| Database   | PostgreSQL 16                                  |
| Auth       | Google OAuth 2.0 + JWT (HS256) + Refresh Token |
| Validation | Zod                                            |
| Logger     | Winston                                        |
| Testing    | `bun test`                                     |

### Frontend (`/client`) not started yet

`client/` currently only has a `Dockerfile`; there is no React app in this
repo yet. The `client` service in `docker-compose.yml` is commented out until
it exists. Planned stack (see root `Centralized User Database.md` and prior
dev notes): React + TypeScript, Vite, MWS-UI-Kit + Tailwind CSS.

### Planned but not wired into code yet

- **MinIO** `server/src/lib/minio.ts` exists but is empty. Env vars
  (`MINIO_*`) are already read by `docker-compose.yml`, but no service in
  `server/src` calls them yet. Intended for consent-record attachments.
- **Rate limiting** deliberately deferred while the project is still in the
  testing phase; see [Roadmap](#roadmap--future-improvements).

## Prerequisites

- Bun (latest)
- Docker & Docker Compose (for PostgreSQL)
- A Google Cloud OAuth 2.0 Client ID/Secret (Google Sign-In is the only login
  method there is no username/password)

## Project Structure

```
server/
├── seed/dev-data-employee.ts
├── seed/dev-data-academic.ts
├── prisma/
│   └── schema.prisma
└── src/
    ├── index.ts
    ├── application/
    │   └── web.ts
    ├── routes/
    │   ├── api-router.ts
    │   ├── auth/
    │   ├── admin/
    │   └── internal/
    ├── middleware/
    │
    ├── controller/
    │   ├── admin/
    │   └── internal/
    ├── service/
    ├── validation/
    ├── model/
    ├── constants/
    │   └── api-scopes.ts
    ├── utils/
    ├── lib/
    ├── error/
    ├── type/
    └── test/
```

### How a request actually flows

Every feature follows the same chain: **route → middleware → controller →
service → validation/prisma → audit log → response**. Concrete example
`PATCH /api/admin/employees/:id` (update an employee):

1. **`routes/admin/index.ts`** mounts `adminAuthMiddleware` on `*`, then
   routes `/employees` to `employee-router.ts`.
2. **`middleware/admin-auth-middleware.ts`** reads the `access_token` cookie,
   verifies the JWT, loads the `AdminUser` row, and sets `c.var.admin`. Any
   failure short-circuits with 401 before the controller ever runs.
3. **`routes/admin/employee-router.ts`** maps the verb/path to
   `EmployeeController.update`.
4. **`controller/admin/employee-controller.ts`** pulls `c.var.admin` and the
   JSON body, forwards them to the service, and wraps the result in
   `c.json({ data })`. It does not contain business rules.
5. **`service/employee-service.ts`** is where the actual rules live: role
   checks (`VIEWER` cannot write; `DATABASE_ADMIN` is confined to their own
   `unit_id`), Zod validation via `validation/employee-validation.ts`,
   duplicate-email/employee_id checks, then the Prisma write.
6. Every mutation calls **`service/audit-service.ts`** to write an
   `AuditLog` row (old/new value snapshot, actor, IP, user agent) before
   returning.
7. **`model/employee-model.ts`**'s `toEmployeeResponse()` shapes the Prisma
   row into the response DTO this is also where `SUPER_ADMIN` gets a
   richer `EmployeeDetailResponse` than other roles.
8. If anything throws a `ResponseError` or `ZodError` along the way,
   **`middleware/error-middleware.ts`** (registered as `web.onError` in
   `web.ts`) catches it centrally and shapes the JSON error response
   unexpected exceptions are logged via Winston and returned to the caller
   as a generic `"Internal Server Error"`, never with the raw internal
   message.

The internal (machine-to-machine) API follows the same shape, just with
`apiClientAuthMiddleware` + `requireScope(...)` instead of
`adminAuthMiddleware`, and `AuditSource.API` instead of `AuditSource.UI` on
the audit log entry.

## Route Groups & Endpoints

| Group        | Prefix            | Auth                                                                        |
| ------------ | ----------------- | --------------------------------------------------------------------------- |
| Public/Auth  | `/api/auth/*`     | None (login endpoints) / cookie (`/me`, `/logout`)                          |
| Admin Panel  | `/api/admin/*`    | JWT cookie `access_token` (`adminAuthMiddleware`)                           |
| Internal API | `/api/internal/*` | `Authorization: Bearer <token_prefix>.<secret>` (`apiClientAuthMiddleware`) |

<details>
<summary>Full endpoint list</summary>

**`/api/auth`**
| Method | Path | Notes |
| ------ | ----------------------- | --------------------------------------------------- |
| POST | `/google` | Google Sign-In routes to Admin _or_ Employee flow |
| POST | `/refresh` | Rotate access + refresh token (admin only) |
| GET | `/me` | Current admin profile (requires cookie) |
| POST | `/logout` | Admin logout, clears cookies |
| GET | `/employee/me` | Current employee profile (employee self-service) |
| POST | `/employee/logout` | Employee logout |

**`/api/admin`** (all routes require `adminAuthMiddleware`)
| Method | Path | Notes |
| ------ | ----------------------------- | ---------------------------------------- |
| POST | `/employees` | Create employee |
| GET | `/employees` | Search/list, paginated |
| GET | `/employees/:id` | Get one (richer detail for SUPER_ADMIN) |
| PATCH | `/employees/:id` | Update |
| PATCH | `/employees/delete/:id` | Soft delete **SUPER_ADMIN only** |
| PATCH | `/employees/restore/:id` | Restore from trash **SUPER_ADMIN only**|
| POST | `/admin-users/promote` | Promote an employee to admin **SUPER_ADMIN only** |
| PATCH | `/admin-users/demote/:id` | Deactivate an admin **SUPER_ADMIN only** |
| POST | `/api-clients` | Create API client + token **SUPER_ADMIN only** |
| GET | `/api-clients` | List API clients (no secrets) **SUPER_ADMIN only** |
| PATCH | `/api-clients/revoke/:id` | Revoke API client **SUPER_ADMIN only** |

**`/api/internal`** (all routes require `apiClientAuthMiddleware`)
| Method | Path | Scope required | Notes |
| ------ | ------------------- | ----------------- | ------------------------------ |
| GET | `/employees/lookup` | `employees:read` | Lookup by `?email=`, active employees only |

</details>

## Authentication & Authorization

There is **one login endpoint** (`POST /api/auth/google`) for both admin and
employee users there is no separate employee login form. `AuthService.loginWithGoogle()`:

1. Verifies the Google authorization code and checks the email domain against
   `ALLOWED_DOMAIN`.
2. If the email matches an **active `AdminUser`**, issues an admin JWT
   (`role` in the payload) plus a refresh token (SHA-256 hash stored in
   `AdminUser.refresh_token_hash`, 7-day expiry).
3. Otherwise, if the email matches an **active `Employee`**, issues a
   short-lived employee JWT (`type: "employee"` in the payload, no refresh
   token employee self-service is read-only, so re-login is cheap).
4. If neither matches, `403 Forbidden`.

Both tokens are set as `httpOnly`, `sameSite: Strict` cookies
(`access_token` / `refresh_token`), never exposed to client-side JS.

`employeeAuthMiddleware` also re-checks on every request whether the
employee has since been **promoted** to an `AdminUser` if so, it forces
401 + re-login instead of serving a stale, under-scoped session.

### Roles (RBAC)

| Role             | Read                          | Create                                                        | Update                                         | Delete/Restore | Manage admins / API clients |
| ---------------- | ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------- | -------------- | --------------------------- |
| `SUPER_ADMIN`    | All units, full detail fields | All units                                                     | All units                                      | Yes            | Yes                         |
| `DATABASE_ADMIN` | Own `unit_id` only            | Own `unit_id` only, **and only if `can_create_data` is true** | Own `unit_id` only, no `can_create_data` check | No             | No                          |
| `VIEWER`         | Own `unit_id` only            | No                                                            | No                                             | No             | No                          |

> Note: the asymmetry above (`can_create_data` gates create but not update
> for `DATABASE_ADMIN`) is what `service/employee-service.ts` currently
> enforces worth confirming that's intentional rather than an oversight.

`unit_id` scoping and the `can_create_data` flag both live on `AdminUser`
(`prisma/schema.prisma`) and are enforced in `service/employee-service.ts`,
not at the route layer the controller/route stay identical for every role.

**Employee self-service** (`/api/auth/employee/*`) is a separate, much
narrower session: read-only access to one's own profile, no dashboard, no
other employees' data.

## Internal API / API Clients

Machine-to-machine access for other internal apps see
[`src/service/api-client-service.ts`](server/src/service/api-client-service.ts)
and [`src/middleware/api-client-auth-middleware.ts`](server/src/middleware/api-client-auth-middleware.ts).

- A `SUPER_ADMIN` creates a client (`name` + `scope_names`); the plaintext
  token (`mws_<prefix>.<secret>`) is returned **once**, at creation only
  its SHA-256 hash is ever stored.
- Secret comparison uses `crypto.timingSafeEqual` (no timing side-channel).
- Every scope check goes through `requireScope()`, typed against
  `src/constants/api-scopes.ts::ApiScopeName` scope-name typos fail at
  compile time instead of silently 403-ing every request in production.
- Revoking a client soft-disables it (`is_active: false`); nothing is
  deleted, and create/revoke are both audit-logged.
- Every successful/failed lookup through `/api/internal/*` is audit-logged
  with `AuditSource.API` and `AuditAction.API_ACCESS`.

## Audit Logging

Every mutation that matters employee CRUD, admin promote/demote, API
client create/revoke, and every internal-API read writes an `AuditLog` row
(`old_values`/`new_values` JSON snapshot, actor, IP, user agent, source:
`UI` / `API` / `SYSTEM` / `IMPORT`). See `AuditAction` in
`prisma/schema.prisma` for the full list of tracked actions.

## Setup & Installation

### 1. Database (Docker)

```bash
docker-compose up -d db
```

Starts PostgreSQL 16 on `localhost:5434` (mapped from container port 5432,
db name `mws-center`).

### 2. Environment variables

Create `server/.env` (gitignored never commit real secrets):

```bash
# Database
DATABASE_URL="postgresql://root:PostgresPassword123@localhost:5434/mws-center?schema=public"

# Auth
JWT_SECRET="min-32-char-random-secret"
ALLOWED_DOMAIN="millennia21.id"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:5173"  # wherever the frontend obtains the Google auth code  not a backend route
CLIENT_URL="http://localhost:5173"

NODE_ENV="development"

# MinIO  read by docker-compose already, not yet consumed by any service (see Roadmap)
MINIO_ENDPOINT="localhost"
MINIO_PORT="9000"
MINIO_USE_SSL="false"
MINIO_ACCESS_KEY=""
MINIO_SECRET_KEY=""
MINIO_BUCKET=""
```

### 3. Install dependencies & set up Prisma

```bash
cd server
bun install
bunx prisma generate
bunx prisma db push
```

### 4. Seed local dev data (recommended)

Since login is Google-only, there's no username/password to test with
locally. Seed scripts are split per feature area — one per
`docs/*-walkthrough.md` — rather than one ever-growing file, so each one's
`--clean` only has to reason about its own slice of data:

- `seed/dev-data-employee.ts` — Employee + admin-auth basics. Creates a dev
  `SUPER_ADMIN`, a dev `Employee`, and a dev API client, then **prints
  ready-to-use JWTs and an API token directly to the console**, bypassing
  the real Google OAuth flow entirely. See `docs/employee-walkthrough.md`.
- `seed/dev-data-academic.ts` — Academic Year / Class / Grade / master data
  (Unit, Job Position, Job Level). See `docs/academic-class-walkthrough.md`.

Each is independent (creates its own dedicated master data/admin/employees
rather than assuming the other has run), so run either alone or both, in
any order:

```bash
bun run seed:dev:employee
bun run seed:dev:academic
```

Copy the printed `access_token` into a cookie (or your REST client's cookie
jar) to hit `/api/admin/*` as `SUPER_ADMIN`, or use the printed API token
with `Authorization: Bearer ...` to hit `/api/internal/*`. To remove
everything a script created:

```bash
bun run seed:dev:employee:clean
bun run seed:dev:academic:clean
```

> **Run both `:clean` commands before `bun test`** the seed data and the
> test suite's fixtures are not designed to coexist.

## Running the Application

```bash
cd server
bun run dev        # bun --hot src/index.ts, http://localhost:3000
```

There is no frontend dev server yet (see [Tech Stack](#tech-stack)).

### Production (Docker Compose)

```bash
docker-compose up -d
```

Brings up `db` + `server` (port `3010` on the host, mapped to container port
`3000` `3000` was already taken by another stack on the deploy VPS). The
`server` container reads its env from Komodo's Stack "Environment" panel,
not from `server/.env` (which is gitignored and won't exist in a fresh
clone).

## Testing

```bash
cd server
bun run seed:dev:employee:clean   # make sure no leftover dev-seed rows conflict
bun run seed:dev:academic:clean
bun test
```

Test files live in `server/src/test/`, one per feature area (`auth`,
`employee`, `admin-user`, `api-client`, `employee-api-lookup`,
`audit-log`), using shared request/mock helpers from `test-utils.ts`.

## CI/CD

`.github/workflows/ci-cd.yml` runs on push/PR to `deploy/testing`:

1. **`backend-tests`** spins up ephemeral Postgres, installs deps,
   `prisma generate` + `db push`, runs `bun test` with dummy env values
   (no real Google/MinIO credentials needed for the test suite).
2. **`deploy-komodo`** only on a push to `deploy/testing` after tests
   pass, triggers a Komodo deploy webhook (HMAC-signed payload).

There is no frontend build job yet `client/` has nothing to build.

## Current Limitations / Not Yet Implemented

These controllers exist as empty scaffolding and are **not wired into any
router** calling them isn't possible yet, they're placeholders for planned
work:

- `controller/admin/academic-year-controller.ts`, `class-controller.ts`,
  `student-controller.ts`, `import-controller.ts`, `export-controller.ts`
- `controller/internal/student-api-controller.ts`,
  `user-lookup-controller.ts` (marked `// TODO: implement`)
- `routes/admin/student-router.ts` is an empty file, not mounted anywhere

MinIO file storage and rate limiting are likewise not implemented yet
see below.

## Roadmap / Future Improvements

1. **Rate limiting** required per the original spec , intentionally deferred until past the current testing
   phase so it doesn't get in the way of iteration.
2. **API client token expiry** tokens currently never expire, only
   revoke manually. Revisit once a real external (non-internal) consumer
   holds one of these tokens long-term.
3. **Multi-scope support in `requireScope()`** today it checks exactly one
   scope per route; will need extending once an endpoint requires a
   combination of scopes.
4. **MinIO integration** wire up `lib/minio.ts` for `ConsentAttachment`
   uploads (already modeled in `prisma/schema.prisma`), matching the
   env vars already threaded through `docker-compose.yml`.
5. **Student & Academic domain** `Student`, `AcademicYear`, `Class`,
   `StudentClassEnrollment`, `ConsentRecord`, `HealthRecord` models already
   exist in the schema; their controllers/services/routes are still
   placeholders.
6. **Internal API expansion** `student-api-controller.ts` and
   `user-lookup-controller.ts` (a generic Student-or-Employee lookup) to
   round out what other internal apps can query.
7. **Import / Export & Google Sheet migration sync** `ImportJob` and
   `SyncLog` models exist; no service consumes them yet.
8. **Frontend** React + Vite admin dashboard, currently nonexistent.
9. **Automated deletion workflow / offboarding checklist** grace-period
   based hard-delete after `deleted_at`, per the original requirements doc.
10. **Google Workspace integration** future scope per the original
    requirements doc (not started).
