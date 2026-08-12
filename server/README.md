# MWS Data Center Server

Bun + Hono API for MWS Data Center. The server owns auth, RBAC, Prisma data
access, audit logging, import/export, internal API clients, MinIO attachment
storage, Redis rate limiting, and dashboard aggregate data.

## Prerequisites

- Bun
- Docker and Docker Compose for local PostgreSQL, Redis, and MinIO
- Google OAuth client credentials for browser login

## Local Setup

From the repo root, start local infrastructure:

```sh
docker-compose up -d db minio redis
```

Then install and prepare the server:

```sh
cd server
bun install
bunx prisma generate
bunx prisma db push
```

Create `server/.env`:

```sh
DATABASE_URL="postgresql://root:PostgresPassword123@localhost:5434/mws-center?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
ALLOWED_DOMAIN="mws.sch.id"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:5173"
CLIENT_URL="http://localhost:5173"
CORS_ORIGINS="http://localhost:5173,http://localhost:4173"
NODE_ENV="development"

MINIO_ENDPOINT="localhost"
MINIO_PORT="9010"
MINIO_USE_SSL="false"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin123"
MINIO_BUCKET="mws-data-center"

REDIS_HOST="localhost"
REDIS_PORT="6380"
REDIS_PASSWORD=""
```

Run the API:

```sh
bun run dev
```

Local API URL: `http://localhost:3000`.

## Seed Scripts

Baseline seeds for a fresh or reset database:

```sh
bun run seed:master-lists
bun run seed:api-scopes
```

- `seed:master-lists` upserts Units, Job Positions, Job Levels, Buildings,
  and Grades.
- `seed:api-scopes` upserts API client scopes.

Optional manual/demo seeds:

```sh
bun run seed:dev:employee
bun run seed:dev:academic
bun run seed:dev:student
```

- `seed:dev:employee` creates dev admin users, employee fixtures, and a dev
  API client. It prints usable JWT/API tokens for REST client testing.
- `seed:dev:academic` creates academic-year/class/teacher fixtures.
- `seed:dev:student` creates student fixtures and related parent, consent,
  health, vaccine, PC activity, and enrollment data.

Clean only the dev seed slices:

```sh
bun run seed:dev:employee:clean
bun run seed:dev:academic:clean
bun run seed:dev:student:clean
```

Google login helper seeds:

```sh
bun run seed:dev:admin
bun run seed:dev:employee-user
```

- `seed:dev:admin` promotes `DEV_ADMIN_EMAIL` from `.env` to active
  `SUPER_ADMIN`.
- `seed:dev:employee-user` creates an employee record for `DEV_ADMIN_EMAIL`
  and deactivates that admin account so employee self-service login can be
  tested.

Historical academic class seed:

```sh
bun run seed:academic-classes
```

This creates historical academic years and classes. Use it for local QA, not
for a clean test database.

## Reset

For a full local cleanup:

```sh
bun run reset:test-data
```

This deletes people, students, employees, admin users, API clients, API
scopes, master data, classes, grades, and academic years. It is destructive
and intended for local/test databases only.

After reset, restore baseline rows:

```sh
bun run seed:master-lists
bun run seed:api-scopes
```

## Testing

Before running the full test suite, keep the database clean:

```sh
bun run seed:dev:employee:clean
bun run seed:dev:academic:clean
bun run seed:dev:student:clean
bun test
```

If manual testing left broad data behind, use `bun run reset:test-data`, then
rerun the baseline seeds before testing.

## Common Commands

```sh
bun run dev
bun run typecheck
bun test
bun run fix:class-status-drift
```
