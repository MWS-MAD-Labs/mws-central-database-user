# Employee Module API Walkthrough

Manual, copy-pasteable walkthrough of every Employee lifecycle operation that's
been built so far: create, read, search, update, soft-delete, restore, plus
the validation/permission rules and the internal API used by other apps.

For the _rigorous_ picture (every edge case, with assertions), read/run
`bun test src/test/employee.test.ts` instead this doc is for getting an
intuitive feel for the API without reading code.

## 0. Setup

### Local dev

```sh
cd server
bun run seed-dev-data.ts
bun run seed-dev-data.ts --clean # clear all data after running this walkthrough
bun run dev   # in a separate terminal, http://localhost:3000
```

### Against a deployed stack (e.g. Komodo)

1. In Komodo, open a terminal **into the `mws-server` container**.
2. Run the seed script there, pointing `SEED_BASE_URL` at a host/port you
   can reach from your own machine (e.g. the VPS IP + the port mapped to
   3000, `3010` in `docker-compose.yml`):

   ```sh
   SEED_BASE_URL=http://<reachable-host>:3010 bun run seed-dev-data.ts
   ```

3. Copy the `--- Copy-paste to set up your shell ---` block it prints, and
   paste it into **your own terminal** (laptop, not inside the container).
4. From there, every `curl` example in sections 1–7 below works as-is.
5. When done, clean up from inside the container again:
   `bun run seed-dev-data.ts --clean`.

### Either way

`bun run seed-dev-data.ts` prints a block titled `--- Copy-paste to set up
your shell ---`. Copy that block verbatim into your terminal it already
has every `export ...` line this doc needs (`BASE`, `ADMIN_TOKEN`,
`DB_ADMIN_TOKEN`, `VIEWER_TOKEN`, `API_TOKEN`, `UNIT_ID`, `POSITION_ID`,
`LEVEL_ID`, `EMPLOYEE_ID`, `EMPLOYEE_2_ID`, `DB_ADMIN_ID`, `VIEWER_ID`), so
there's nothing to hand-substitute.

These only live in the current shell session. If you open a new terminal,
or the dev server restarts and you re-seed, paste the block again with the
fresh values. All the `*_TOKEN` vars expire after 24h.

Everything below uses the `access_token` cookie for admin-panel calls (Super
Admin, seeded by the script) and the `Authorization: Bearer` header for the
internal API calls (used by other apps like Daily Check-in / MTSS).

## 1. Create an employee

```sh
curl -s -X POST "$BASE/api/admin/employees" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{
    "full_name": "Budi Santoso",
    "nick_name": "Budi",
    "email": "budi.santoso@mws-demo.local",
    "gender": "MALE",
    "religion": "ISLAM",
    "birth_place": "Jakarta",
    "birth_date": "1995-01-01T00:00:00.000Z",
    "employee_id": "26.01.001",
    "status": "ACTIVE",
    "employment_type": "PERMANENT",
    "unit_id": "'"$UNIT_ID"'",
    "job_position_id": "'"$POSITION_ID"'",
    "job_level_id": "'"$LEVEL_ID"'",
    "building": "Main Building",
    "join_date": "2026-01-01T00:00:00.000Z"
  }' | tee /tmp/employee.json | jq .

export EMPLOYEE_ID=$(jq -r .data.id /tmp/employee.json)
```

Try it again with the same `email` or `employee_id` you'll get a clean
`400 "Email already registered"` / `"Employee ID already registered"` instead
of a DB error. Same for an `unit_id`/`job_position_id`/`job_level_id` that
doesn't exist `400 "Invalid unit: referenced record does not exist"`.

## 2. Get one employee

```sh
curl -s "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .
```

Super Admin gets the detailed response (includes gender/religion/birth
date/place). Database Admin and Viewer get the basic response those
sensitive fields come back `undefined`.

## 3. Search / list (filter, sort, pagination)

```sh
# keyword search across name/email/employee_id
curl -s "$BASE/api/admin/employees?search=budi" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .

# filter + sort + page
curl -s "$BASE/api/admin/employees?status=ACTIVE&sort_by=full_name&sort_order=asc&page=1&size=10" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .
```

`paging.total_page`/`total_item` reflect the filtered count, not the whole
table.

## 4. Update

```sh
curl -s -X PATCH "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "building": "South Wing", "assigned_class": "Grade 5 Sombrero" }' | jq .
```

Setting `status` to `RESIGNED` without `resignation_date` is rejected:

```sh
curl -s -X PATCH "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "status": "RESIGNED" }' | jq .
# -> 400 "Resignation date is required when status is RESIGNED"

curl -s -X PATCH "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "status": "RESIGNED", "resignation_date": "2026-06-30T00:00:00.000Z" }' | jq .
# -> 200
```

`last_working_date` and `notes` (both shown under `offboarding` in the
response) are set the same way, on create or update:

```sh
curl -s -X PATCH "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "last_working_date": "2026-06-30T00:00:00.000Z", "notes": "Handover completed" }' | jq .
```

## 5. Soft-delete, trash bin, restore

```sh
# soft-delete   Content-Type is required here even with no body, see note below
curl -s -X PATCH "$BASE/api/admin/employees/delete/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" -H "Cookie: access_token=$ADMIN_TOKEN" | jq .

# gone from the default list
curl -s "$BASE/api/admin/employees" -H "Cookie: access_token=$ADMIN_TOKEN" | jq '.data | length'

# shows up in the trash bin
curl -s "$BASE/api/admin/employees?is_deleted=true" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .

# restore
curl -s -X PATCH "$BASE/api/admin/employees/restore/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" -H "Cookie: access_token=$ADMIN_TOKEN" | jq .
```

> **Why `Content-Type` matters here even with no body:** Hono's `csrf()`
> middleware (`web.ts`) treats a _missing_ `Content-Type` as `text/plain`,
> which it flags as a possible form submission and blocks unless the request
> carries an `Origin`/`Sec-Fetch-Site` header proving it's same-origin. A
> real browser always sends those automatically, but curl/Postman without
> explicit headers doesn't so a bare `curl -X PATCH .../delete/:id` with no
> headers gets a `403`. Always send `Content-Type: application/json` on
> mutating calls, even bodyless ones, when testing by hand.

Restore only works from the trash bin try it again and you'll get
`400 "Employee is not in the trash bin. It might be active or permanently
deleted."`.

## 6. Permission boundaries

The seed script also creates a Database Admin and a Viewer, both scoped to
the same unit as `$ADMIN_TOKEN`, plus a second employee (`$EMPLOYEE_2_ID`)
that lives in a different unit (`DEV_UNIT_2`) so cross-unit blocking is
actually demonstrable, not just described.

```sh
# Viewer can read...
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/employees/$EMPLOYEE_ID"
# -> 200

# ...but every write is blocked
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -d '{ "building": "Nope" }'
# -> 403 "Forbidden: Viewer cannot update data"

# Database Admin can read/write within their own unit...
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Cookie: access_token=$DB_ADMIN_TOKEN" "$BASE/api/admin/employees/$EMPLOYEE_ID"
# -> 200

# ...but an employee in a different unit is invisible to them
curl -s -H "Cookie: access_token=$DB_ADMIN_TOKEN" "$BASE/api/admin/employees/$EMPLOYEE_2_ID"
# -> 404 "Employee not found"

# Super Admin sees both units
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/employees/$EMPLOYEE_2_ID"
# -> 200
```

`can_write_data` is a separate gate on top of unit scope: the seeded
Database Admin has it set to `true`, so create/update succeed within their
unit. Flip it off to see the block (Super Admin only, and only valid on a
`DATABASE_ADMIN` target):

```sh
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "can_write_data": false }' \
  "$BASE/api/admin/admin-users/can-write-data/$DB_ADMIN_ID" | jq .

# now DB Admin creates/updates within their own unit get a 403
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$DB_ADMIN_TOKEN" \
  "$BASE/api/admin/employees/$EMPLOYEE_ID" -d '{ "building": "Nope" }'
# -> 403 "Forbidden: You don't have permission to update data"
```

Toggling to a value it's already set to, or targeting a non-`DATABASE_ADMIN`
account, is rejected with `400`. Every change is written to `AuditLog` with
`action: PERMISSION_CHANGE`.

## 7. Internal API (used by other apps, e.g. Daily Check-in / MTSS)

Token-based, scoped, separate from the admin-panel cookie auth:

```sh
curl -s -H "Authorization: Bearer $API_TOKEN" \
  "$BASE/api/internal/employees/lookup?email=budi.santoso@mws-demo.local" | jq .
```

Every call here success or not-found is written to `AuditLog` with
`action: API_ACCESS` and the calling `api_client_id`, and it also bumps that
client's `last_used_at`. A revoked or wrong-scope token gets `401`/`403`
instead of leaking anything.

## 8. Where the rest of the picture is

- **Every rule above, plus every edge case** (invalid enums, missing fields,
  cross-unit transfer attempts, revoked API clients, etc.): `bun test
src/test/employee.test.ts` and `bun test src/test/error-middleware.test.ts`.
- **Who changed what, when**: `AuditLog` rows written on every
  create/update/delete/restore, with before/after snapshots query via
  Prisma Studio (`bunx prisma studio`) or directly against the `audit_logs`
  table.
