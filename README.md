# MWS Data Center

Centralized user database for MWS — a single source of truth for Employee and
Student data, shared with other internal apps (Daily Check-in, MTSS, Reading
Buddy, Exima) through a scoped, token-based internal API. Admin panel access
and internal-API access both flow through one identity system, with every
sensitive read/write recorded to an audit log.

## Documentation

- [Admin Guide](docs/admin-guide.md)
- [Technical Guide](docs/technical-guide.md)
- [Architecture Overview](docs/architecture-overview.md)
- [Documentation Index](docs/README.md)

## Tech Stack

### Backend (`/server`)

| Layer         | Tool                                           |
| ------------- | ---------------------------------------------- |
| Runtime       | Bun                                            |
| Framework     | Hono                                           |
| ORM           | Prisma + `@prisma/adapter-pg`                  |
| Database      | PostgreSQL 16                                  |
| Auth          | Google OAuth 2.0 + JWT (HS256) + Refresh Token |
| Validation    | Zod                                            |
| Rate Limiting | `rate-limiter-flexible` + Redis                |
| File Storage  | MinIO (S3-compatible)                          |
| Logger        | Winston                                        |
| Testing       | `bun test`                                     |

### Frontend (`/client`)

| Layer     | Tool                          |
| --------- | ----------------------------- |
| Framework | React 19 + Vite               |
| Routing   | React Router v8               |
| Styling   | Tailwind CSS v4 + MWS-UI-Kit  |
| Data      | TanStack Query v5 + Fetch API |
| Forms     | React Hook Form + Zod         |
| Container | Nginx static server           |

### Infrastructure

| Service    | Tool                        |
| ---------- | --------------------------- |
| Database   | PostgreSQL 16 (Docker)      |
| Cache      | Redis 7 (rate limiting)     |
| Storage    | MinIO (consent attachments) |
| Deployment | Docker Compose + Komodo     |

## Prerequisites

- Bun (latest)
- Docker & Docker Compose (PostgreSQL, MinIO, Redis, and the full stack)
- A Google Cloud OAuth 2.0 Client ID/Secret (Google Sign-In is the only login
  method — there is no username/password)

## Project Structure

```
server/
├── seed/
├── prisma/
│   └── schema.prisma
└── src/
    ├── index.ts
    ├── application/
    │   └── web.ts
    ├── routes/
    │   ├── api-router.ts
    │   ├── auth/
    │   ├── admin/         (16 sub-routers)
    │   └── internal/
    ├── middleware/
    ├── controller/
    │   ├── admin/
    │   └── internal/
    ├── service/
    ├── validation/
    ├── model/
    ├── constants/
    │   └── api-scopes.ts
    ├── utils/
    ├── lib/               (prisma, redis, minio, logger)
    ├── error/
    ├── type/
    └── test/

client/
└── src/
    ├── main.jsx
    ├── app/               (App.jsx, AppProviders.jsx)
    ├── features/          (auth, students, employees, academic, …)
    ├── components/        (shared UI)
    ├── routes/            (ProtectedRoute, RoleHome)
    ├── hooks/
    ├── lib/               (api.js, clientSession.js, …)
    └── config/            (env.js)
```

### How a request flows (server)

Every feature follows the same chain: **route → middleware → controller →
service → validation/prisma → audit log → response**. Concrete example
`PATCH /api/admin/employees/:id` (update an employee):

1. **`routes/admin/index.ts`** applies `adminLimiterMiddleware` and
   `adminAuthMiddleware` on `*`, then routes `/employees` to
   `employee-router.ts`.
2. **`middleware/admin-auth-middleware.ts`** reads the `access_token` cookie,
   verifies the JWT, loads the `AdminUser` row, and sets `c.var.admin`. Any
   failure short-circuits with 401 before the controller ever runs.
3. **`routes/admin/employee-router.ts`** maps the verb/path to
   `EmployeeController.update`.
4. **`controller/admin/employee-controller.ts`** pulls `c.var.admin` and the
   JSON body, forwards them to the service, and wraps the result in
   `c.json({ data })`. It does not contain business rules.
5. **`service/employee-service.ts`** is where the actual rules live: role
   checks, Zod validation via `validation/employee-validation.ts`,
   duplicate-email/employee_id checks, then the Prisma write.
6. Every mutation calls **`service/audit-service.ts`** to write an `AuditLog`
   row (old/new value snapshot, actor, IP, user agent) before returning.
7. **`model/employee-model.ts`**'s `toEmployeeResponse()` shapes the Prisma
   row into the response DTO — this is also where `SUPER_ADMIN` gets a richer
   `EmployeeDetailResponse` than other roles.
8. If anything throws a `ResponseError` or `ZodError` along the way,
   **`middleware/error-middleware.ts`** (registered as `web.onError` in
   `web.ts`) catches it centrally — unexpected exceptions are logged via
   Winston and returned as a generic `"Internal Server Error"`, never with
   the raw internal message.

The internal (machine-to-machine) API follows the same shape, just with
`apiClientAuthMiddleware` + `requireScope(...)` instead of
`adminAuthMiddleware`, and `AuditSource.API` instead of `AuditSource.UI` on
the audit log entry.

### How the client fetches data

All HTTP calls from the React app go through `src/lib/api.js → apiRequest()`:

1. `fetch()` is called with `credentials: 'include'` so the `access_token`
   cookie is sent automatically.
2. If the server returns **401**, `apiRequest` fires `POST /api/auth/refresh`
   once (a singleton promise — parallel 401s share one refresh attempt, not
   many), updates the local `sessionStorage` session record, and retries the
   original request transparently.
3. If refresh also fails, an `ApiError` is thrown and **TanStack Query's
   `QueryCache.onError`** picks it up globally, showing a toast.

Session metadata (type, `expires_at`) is kept in `sessionStorage` under
`mws.clientSession`. The token itself is never accessible to JS — it lives in
the HttpOnly cookie only.

## Route Groups & Endpoints

| Group        | Prefix            | Auth                                                                        |
| ------------ | ----------------- | --------------------------------------------------------------------------- |
| Public/Auth  | `/api/auth/*`     | None (login endpoints) / cookie (`/me`, `/logout`)                          |
| Dashboard    | `/api/dashboard/*` | JWT cookie `access_token` (`dashboardAuthMiddleware`, admin or employee)     |
| Admin Panel  | `/api/admin/*`    | JWT cookie `access_token` (`adminAuthMiddleware`)                           |
| Internal API | `/api/internal/*` | `Authorization: Bearer <token_prefix>.<secret>` (`apiClientAuthMiddleware`) |

<details>
<summary>Full endpoint list</summary>

**`/api/auth`**
| Method | Path | Notes |
| ------ | ----------------------- | --------------------------------------------------- |
| POST | `/google` | Google Sign-In — routes to Admin _or_ Employee flow |
| POST | `/refresh` | Rotate access + refresh token (admin only) |
| GET | `/me` | Current admin profile (requires cookie) |
| POST | `/logout` | Admin logout, clears cookies |
| GET | `/employee/me` | Current employee profile (employee self-service) |
| POST | `/employee/logout` | Employee logout |

**`/api/dashboard`** (requires an active admin or active employee cookie)
| Method | Path | Notes |
| ------ | ---------- | --------------------------------------------- |
| GET | `/summary` | Public dashboard aggregate metrics, no sensitive fields |

**`/api/admin`** (all routes require `adminAuthMiddleware`)
| Method | Path | Notes |
| ------ | --------------------------------------- | ------------------------------------------ |
| POST | `/employees` | Create employee |
| GET | `/employees` | Search/list, paginated |
| GET | `/employees/:id` | Get one |
| PATCH | `/employees/:id` | Update |
| PATCH | `/employees/delete/:id` | Soft delete — `SUPER_ADMIN` only |
| PATCH | `/employees/restore/:id` | Restore — `SUPER_ADMIN` only |
| POST | `/students` | Create student |
| GET | `/students` | Search/list, paginated |
| GET | `/students/:id` | Get one |
| PATCH | `/students/:id` | Update |
| PATCH | `/students/delete/:id` | Soft delete |
| PATCH | `/students/restore/:id` | Restore |
| PATCH | `/students/bulk/delete` | Bulk soft delete |
| PATCH | `/students/bulk/restore` | Bulk restore |
| PATCH | `/students/:id/reissue-nis` | Re-generate NIS |
| GET | `/enrollments` | Search/list all enrollments, paginated |
| POST | `/enrollments/bulk` | Bulk enroll multiple students |
| PATCH | `/enrollments/bulk/promote` | Bulk promote multiple student enrollments |
| POST | `/students/:id/enrollments` | Create enrollment for a student |
| GET | `/students/:id/enrollments` | Get enrollment history for a student |
| PATCH | `/students/:id/enrollments/:enrollmentId/promote` | Promote student to next grade |
| PATCH | `/students/:id/enrollments/:enrollmentId/transfer` | Transfer student to another class |
| PATCH | `/students/:id/enrollments/:enrollmentId/close` | Close/withdraw student enrollment |
| PATCH | `/students/:id/enrollments/delete/:enrollmentId` | Soft delete enrollment record |
| PATCH | `/students/:id/enrollments/restore/:enrollmentId` | Restore enrollment record |
| GET | `/academic-years` | List academic years |
| POST | `/academic-years` | Create academic year |
| PATCH | `/academic-years/:id` | Update |
| DELETE | `/academic-years/:id` | Delete |
| GET | `/classes` | List classes |
| POST | `/classes` | Create class |
| PATCH | `/classes/:id` | Update |
| DELETE | `/classes/:id` | Delete |
| GET | `/grades` | List grades |
| POST | `/grades` | Create grade |
| PATCH | `/grades/:id` | Update |
| DELETE | `/grades/:id` | Delete |
| GET | `/units` | Master units |
| POST | `/units` | Create |
| PATCH | `/units/:id` | Update |
| DELETE | `/units/:id` | Delete |
| GET | `/job-positions` | Master job positions |
| GET | `/job-levels` | Master job levels |
| GET | `/buildings` | Master buildings |
| GET | `/working-days` | Working day overrides |
| POST | `/admin-users/promote` | Promote employee to admin — `SUPER_ADMIN` only |
| PATCH | `/admin-users/demote/:id` | Deactivate admin — `SUPER_ADMIN` only |
| POST | `/api-clients` | Create API client + token — `SUPER_ADMIN` only |
| GET | `/api-clients` | List API clients (no secrets) — `SUPER_ADMIN` only |
| PATCH | `/api-clients/revoke/:id` | Revoke — `SUPER_ADMIN` only |
| GET | `/audit-logs` | Paginated audit log |
| GET | `/support-assignments` | Student support assignments |
| POST | `/support-assignments` | Assign support teacher |

**`/api/internal`** (all routes require `apiClientAuthMiddleware`)
| Method | Path | Scope required | Notes |
| ------ | -------------------------------- | ----------------------------------------- | ------------------------------ |
| GET | `/employees/lookup` | `employees:read` | Lookup by `?email=`, active only |
| GET | `/students` | `students:read` | List/search students |
| GET | `/students/:id` | `students:read` | Get one student |
| GET | `/students/:id/academic-history` | `students:academic_history:read` | Enrollment history |
| GET | `/students/:id/health` | `students:health:read` | Health record + notes |
| GET | `/students/:id/consents` | `students:consent:read` | Consent records |
| GET | `/students/:id/support-contacts` | `students:support_contacts:read` | Support assignments |

</details>

## Authentication & Authorization

There is **one login endpoint** (`POST /api/auth/google`) for both admin and
employee users — there is no separate employee login form.
`AuthService.loginWithGoogle()`:

1. Verifies the Google authorization code and checks the email domain against
   `ALLOWED_DOMAIN`.
2. If the email matches an **active `AdminUser`**, issues an admin JWT
   (`role` in the payload) plus a refresh token (hashed, stored in
   `AdminUser.refresh_token_hash`, 7-day expiry).
3. Otherwise, if the email matches an **active `Employee`**, issues a
   short-lived employee JWT (`type: "employee"`, no refresh token — employee
   self-service is read-only, so re-login is cheap).
4. If neither matches, `403 Forbidden`.

Both tokens are set as `httpOnly`, `sameSite: Strict` cookies
(`access_token` / `refresh_token`), never exposed to client-side JS.

### Token Lifetimes

| Token           | Stored          | TTL    | Who gets it      |
| --------------- | --------------- | ------ | ---------------- |
| `access_token`  | HttpOnly cookie | 15 min | Admin + Employee |
| `refresh_token` | HttpOnly cookie | 7 days | Admin only       |

### Roles (RBAC)

| Role             | Read                   | Write                              | Delete/Restore | Manage admins/API clients |
| ---------------- | ---------------------- | ---------------------------------- | -------------- | ------------------------- |
| `SUPER_ADMIN`    | All units, full detail | All units                          | Yes            | Yes                       |
| `DATABASE_ADMIN` | Own `unit_id` only     | Own `unit_id`, if `can_write_data` | No             | No                        |
| `VIEWER`         | Own `unit_id` only     | No                                 | No             | No                        |

Beyond roles, each `AdminUser` has two fine-grained flags:

- **`can_write_data`** — gates all create/update/delete for `DATABASE_ADMIN`.
- **`can_view_sensitive_data`** — gates access to fields like NIK, NPWP, bank
  account number, BPJS numbers (returned only when this flag is true).
- **`after_hours_write_until`** — optional timestamp; a `DATABASE_ADMIN` may
  be allowed to write outside business hours until this time.

`unit_id` scoping and these flags live on `AdminUser` in `prisma/schema.prisma`
and are enforced in the service layer — not at the route layer.

**Employee self-service** (`/api/auth/employee/*`) is a separate, much
narrower session: read-only access to one's own profile plus the public
dashboard summary, no admin routes, and no other employees' detail records.

## Internal API / API Clients

Machine-to-machine access for other internal apps — see
[`src/service/api-client-service.ts`](server/src/service/api-client-service.ts)
and [`src/middleware/api-client-auth-middleware.ts`](server/src/middleware/api-client-auth-middleware.ts).

- A `SUPER_ADMIN` creates a client (`name` + `scope_names`); the plaintext
  token (`{prefix}.{secret}`) is returned **once** at creation — only its
  hash is ever stored.
- Secret comparison uses constant-time comparison (no timing side-channel).
- Every scope check goes through `requireScope()`, typed against
  `src/constants/api-scopes.ts::ApiScopeName` — scope-name typos fail at
  compile time instead of silently 403-ing in production.
- Revoking a client soft-disables it (`is_active: false`); nothing is
  deleted, and create/revoke are both audit-logged.
- Every lookup through `/api/internal/*` is audit-logged with
  `AuditSource.API` and `AuditAction.API_ACCESS`.

### Available Scopes

| Scope                            | Grants access to      |
| -------------------------------- | --------------------- |
| `employees:read`                 | Employee lookup       |
| `students:read`                  | Student basic data    |
| `students:academic_history:read` | Enrollment history    |
| `students:health:read`           | Health record + notes |
| `students:consent:read`          | Consent records       |
| `students:support_contacts:read` | Support assignments   |

## Rate Limiting

All routes are rate-limited via Redis (`rate-limiter-flexible`). Key is
`{METHOD}_{routePattern}_{clientIP}`.

| Limiter     | Limit        | Window | Applied to                    |
| ----------- | ------------ | ------ | ----------------------------- |
| Auth        | 5 requests   | 15 min | `/api/auth/*`                 |
| Admin read  | 100 requests | 3 min  | Admin `GET` requests          |
| Admin write | 20 requests  | 1 min  | Admin `POST/PUT/PATCH/DELETE` |
| Internal    | 300 requests | 1 min  | `/api/internal/*`             |

When a limit is exceeded the server returns `429` with a
`Retry-After` header and a JSON body `{ "errors": "Too many requests. Try
again in Ns." }`. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset` are always included on every response.

Rate limiting is **skipped** when `NODE_ENV=test` or `CI=true`.

## Audit Logging

Every mutation that matters — employee CRUD, student CRUD, enrollment changes,
admin promote/demote, API client create/revoke, import/export, file
upload/download, and every internal-API read — writes an `AuditLog` row
(`old_values`/`new_values` JSON snapshot, actor, IP, user agent, source:
`UI` / `API` / `SYSTEM` / `IMPORT`). See `AuditAction` in
`prisma/schema.prisma` for the full list of tracked actions.

Audit logs **cannot be deleted** — no soft-delete, no delete endpoint.

## Setup & Installation

For the shortest local path, run the infrastructure first, then install both
apps, prepare Prisma, seed baseline data, and start the two dev servers:

```bash
docker-compose up -d db minio redis

cd server
bun install
bunx prisma generate
bunx prisma db push
bun run seed:master-lists
bun run seed:api-scopes
bun run seed:dev:employee
bun run dev

# in another shell
cd client
bun install
bun run dev
```

Frontend runs at `http://localhost:5173`. The local backend runs at
`http://localhost:3000`.

### 1. Local infra (Docker)

```bash
docker-compose up -d db minio redis
```

Starts:

- PostgreSQL 16 on `localhost:5434`
- MinIO on `localhost:9010` (API) / `localhost:9011` (console)
- Redis on `localhost:6380`

### 2. Environment variables

Create `server/.env` (gitignored — never commit real secrets):

```bash
# Database
DATABASE_URL="your-database-url"

# Auth
JWT_SECRET="[ENCRYPTION_KEY]"
ALLOWED_DOMAIN="mws.sch.id"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:5173"
CLIENT_URL="http://localhost:5173"
CORS_ORIGINS="http://localhost:5173,http://localhost:4173"

NODE_ENV="development"

# MinIO
MINIO_ENDPOINT="localhost"
MINIO_PORT="9010"
MINIO_USE_SSL="false"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin123"
MINIO_BUCKET="mws-data-center"

# Redis
REDIS_HOST="localhost"
REDIS_PORT="6380"
REDIS_PASSWORD=""
```

Create `client/.env`:

```bash
VITE_API_BASE_URL="http://localhost:3000"
VITE_GOOGLE_CLIENT_ID="your-google-oauth-client-id"
VITE_GOOGLE_REDIRECT_URI="http://localhost:5173"
```

### 3. Install dependencies & set up Prisma

```bash
cd server
bun install
bunx prisma generate
bunx prisma db push

cd ../client
bun install
```

### 4. Seed baseline data

Run these after a fresh database setup or after `reset:test-data`:

```bash
cd server
bun run seed:master-lists
bun run seed:api-scopes
```

- `seed:master-lists` restores the real master units, job positions, job
  levels, buildings, and grade rows. The reset script deletes all of those,
  so this is the first seed to run afterward.
- `seed:api-scopes` restores `ApiScope` rows needed before API clients can be
  created.

Optional academic baseline:

```bash
bun run seed:academic-classes
```

This creates historical academic years and classes for local exploration. It
is useful for manual QA, but some academic tests expect a cleaner database.

### 5. Seed local dev data

Since login is Google-only, there's no username/password to test with
locally. Seed scripts are split per feature area so each `--clean` only
reasons about its own slice of data:

- `seed/dev-data-employee.ts` — creates a dev `SUPER_ADMIN`, a dev
  `Employee`, and a dev API client, then **prints ready-to-use JWTs and an
  API token to the console**, bypassing real Google OAuth.
- `seed/dev-data-academic.ts` — Academic Year / Class / Grade / master data.
- `seed/dev-data-student.ts` — Student + enrollment fixtures.
- `seed/dev-admin-user.ts` — promotes `DEV_ADMIN_EMAIL` from `server/.env` to
  an active `SUPER_ADMIN` for real Google Sign-In testing.
- `seed/dev-employee-user.ts` — creates an active employee for
  `DEV_ADMIN_EMAIL` and deactivates the matching admin account so employee
  self-service login can be tested.

Each script is independent — run any or all, in any order:

```bash
bun run seed:dev:employee
bun run seed:dev:academic
bun run seed:dev:student
bun run seed:dev:admin
bun run seed:dev:employee-user
```

Copy the printed `access_token` into your REST client's cookie jar to hit
`/api/admin/*` as `SUPER_ADMIN`, or use the API token with
`Authorization: Bearer ...` for `/api/internal/*`.

To clean up:

```bash
bun run seed:dev:employee:clean
bun run seed:dev:academic:clean
bun run seed:dev:student:clean
```

> **Run all `:clean` commands before `bun test`** — seed data and test
> fixtures are not designed to coexist.

### 6. Reset local/test data

For a full local cleanup before tests or after messy manual QA, use:

```bash
bun run reset:test-data
```

This is destructive. It deletes people, students, employees, admin users, API
clients, master data, API scopes, classes, grades, and academic years. After
running it, restore baseline rows before starting normal dev work or tests:

```bash
bun run seed:master-lists
bun run seed:api-scopes
```

If you need manual demo data again, rerun the relevant `seed:dev:*` scripts.

There are also one-off utility scripts:

```bash
bun run seed:master-lists        # seed Units, Job Positions, Job Levels, Buildings, Grades
bun run seed:api-scopes          # seed ApiScope rows (required for API client creation)
bun run seed:academic-classes    # seed classes for existing academic years
bun run fix:class-status-drift   # repair class status drift from enrollment data
```

## Running the Application

```bash
cd server
bun run dev        # bun --hot src/index.ts, http://localhost:3000
```

In another shell:

```bash
cd client
bun run dev        # Vite, http://localhost:5173
```

### Production (Docker Compose)

```bash
docker-compose up -d
```

Brings up `db`, `minio`, `redis`, `server`, and `client`. The API is
published on host port `3010` (container `3000`). The client is published on
port `5173` and proxies `/api` to the `server` container through Nginx.

The `server` container reads env from Komodo's Stack "Environment" panel or a
root `.env` next to the compose file — not from `server/.env` (which is
gitignored). The client writes its public runtime config to `/env.js` at
container startup via `docker-entrypoint.d/` so a single image can be
reused across environments without a rebuild.

For local HTTP (not HTTPS) in Docker, set `NODE_ENV=development` so cookies
are not marked `Secure`.

## Testing

```bash
cd server
bun run seed:dev:employee:clean
bun run seed:dev:academic:clean
bun run seed:dev:student:clean
bun test
```

If manual testing left broad data in the database, run the full reset first:

```bash
bun run reset:test-data
bun run seed:master-lists
bun run seed:api-scopes
bun test
```

Test files live in `server/src/test/`, one per feature area, using shared
request/mock helpers from `test-utils.ts`.

## CI/CD

`.github/workflows/ci-cd.yml` runs on push/PR to `staging`:

1. **`backend-tests`** — spins up ephemeral Postgres, installs deps,
   `prisma generate` + `db push`, runs `bun test` with dummy env values
   (no real Google/MinIO credentials needed).
2. **`deploy-komodo`** — only on push to `staging` after tests pass,
   triggers a Komodo deploy webhook (HMAC-signed payload).
