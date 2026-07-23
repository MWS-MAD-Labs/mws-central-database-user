# Employee Module API Walkthrough

Manual, copy-pasteable walkthrough of every Employee lifecycle operation
built so far: create, read, search, update, soft-delete, restore, plus the
validation/permission rules and the internal API used by other apps.

For the rigorous picture (every edge case, with assertions), run
`bun test src/test/employee.test.ts` instead. This doc is just for getting a
feel for the API without reading code.

## 0. Setup

### Local dev

```sh
cd server
bun run seed:dev:employee
bun run seed:dev:employee:clean # clear all data after running this walkthrough
bun run dev   # in a separate terminal, http://localhost:3000
```

Just `package.json` shortcuts for `bun run seed/dev-data-employee.ts` (with
or without `--clean`). Raw path still works if you'd rather type that out.

### Against a deployed stack (e.g. Komodo)

1. In Komodo, open a terminal into the `mws-server` container.
2. Run the seed script there, pointing `SEED_BASE_URL` at a host/port you
   can reach from your own machine (e.g. the VPS IP + the port mapped to
   3000, `3010` in `docker-compose.yml`):

   ```sh
   SEED_BASE_URL=http://<reachable-host>:3010 bun run seed:dev:employee
   ```

3. Copy the `--- Copy-paste to set up your shell ---` block it prints into
   your own terminal (laptop, not inside the container).
4. Every `curl` example in sections 1-7 below works as-is from there.
5. Clean up from inside the container when done:
   `bun run seed:dev:employee:clean`.

### Either way

`bun run seed:dev:employee` prints a block titled `--- Copy-paste to set up
your shell ---`. Copy it verbatim into your terminal, it already has every
`export ...` line this doc needs (`BASE`, `ADMIN_TOKEN`, `DB_ADMIN_TOKEN`,
`VIEWER_TOKEN`, `API_TOKEN`, `UNIT_ID`, `POSITION_ID`, `LEVEL_ID`,
`EMPLOYEE_ID`, `EMPLOYEE_2_ID`, `DB_ADMIN_ID`, `VIEWER_ID`). Nothing to
hand-substitute.

These only live in your current shell session. New terminal, or the dev
server restarts and you re-seed? Paste the block again with the fresh
values. All the `*_TOKEN` vars expire after 24h.

Admin-panel calls below use the `access_token` cookie (Super Admin, seeded
by the script). The internal API calls (used by other apps like Daily
Check-in / MTSS) use the `Authorization: Bearer` header instead.

## 1. Create an employee

Every field below is accepted by `POST`. Only `marital_status` is required
on top of the fields that already existed before the PII fields got added
(`photo_url`, `mobile_phone`, `residential_address`, `nik`, `npwp`,
`bank_account_number`, `bpjs_number` are all optional). This example fills
in everything so you can see what a fully populated record looks like end
to end:

`email` has to end with `@$ALLOWED_DOMAIN` (`millennia21.id` in `.env`).
That's different from the seed script's own accounts, which deliberately
use `@mws-dev.local` so `bun test`'s cleanup doesn't sweep them up (it
mass-deletes anything under `@millennia21.id`). This demo employee doesn't
have that protection, so avoid running `bun test` mid-walkthrough or it'll
vanish. Just re-run the `POST` below if that happens.

```sh
curl -s -X POST "$BASE/api/admin/employees" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{
    "full_name": "Budi Santoso",
    "nick_name": "Budi",
    "email": "budi.santoso@millennia21.id",
    "gender": "MALE",
    "religion": "ISLAM",
    "birth_place": "Jakarta",
    "birth_date": "1995-01-01T00:00:00.000Z",
    "photo_url": "https://mws-demo.local/photos/budi.jpg",

    "employee_id": "26.01.001",
    "status": "ACTIVE",
    "employment_type": "PERMANENT",
    "unit_id": "'"$UNIT_ID"'",
    "job_position_id": "'"$POSITION_ID"'",
    "job_level_id": "'"$LEVEL_ID"'",
    "building": "Main Building",
    "join_date": "2026-01-01T00:00:00.000Z",

    "marital_status": "SINGLE",
    "mobile_phone": "0812-3456-7890",
    "residential_address": "Jl. Merdeka No. 1, Jakarta",
    "nik": "1111111111111111",
    "npwp": "11.111.111.1-123.000",
    "bank_account_number": "12 34 56 78 90",
    "bpjs_number": "0001 2345 6789 0"
  }' | tee /tmp/employee.json | jq .

export EMPLOYEE_ID=$(jq -r .data.id /tmp/employee.json)
```

`resignation_date`, `last_working_date`, and `notes` are left out here on
purpose. They're offboarding-only fields, only meaningful once `status` is
`RESIGNED`, and get their own example in section 4.

Run it twice with the same `email` or `employee_id` and you get a clean
`400 "Email already registered"` / `"Employee ID already registered"`
instead of a raw DB error. Same story for a bad `unit_id` /
`job_position_id` / `job_level_id`: `400 "Invalid unit: referenced record
does not exist"`.

`nik` and `npwp` are both tax/national-ID fields but not interchangeable:

- `nik`: the 16-digit NIK, which since the tax reform also doubles as the
  new-format NPWP. Always 16 plain digits, no official punctuated form,
  unlike `npwp` below.
- `npwp`: the old 15-digit NPWP format (`XX.XXX.XXX.X-XXX.XXX`), for
  employees whose tax ID hasn't migrated to the NIK-based format yet.
  Traditionally written with dots and a dash, as shown above.

Both (plus `bank_account_number`, `bpjs_number`, `mobile_phone`) get
normalized before storage. Punctuation gets stripped, only digits are kept,
so a stray space or dash someone pastes in by accident won't cause a false
rejection. `npwp` above lands as `111111111123000` (15 digits),
`bank_account_number` as `1234567890` (10 digits, BCA), `bpjs_number` as
`0001234567890` (13 digits), `mobile_phone` as `6281234567890` regardless
of whether you typed `08xx`, `+628xx`, or `628xx`. Anything that doesn't
normalize to the expected digit count gets rejected with a `400`.

`nik`, `npwp`, `bank_account_number`, `bpjs_number`, and `marital_status`
are Super-Admin-only, same tier as `gender`/`religion`/`birth_place`/
`birth_date`. They come back `undefined` for Database Admin and Viewer.
`mobile_phone` and `residential_address` sit one tier down: visible to
Super Admin and Database Admin, `undefined` for Viewer. Read-only access
doesn't need to extend to an employee's personal phone/address. Also worth
knowing: `create`/`update`/`search` responses always return the basic
(non-sensitive) shape no matter the caller's role. The Super-Admin detail
view with all the sensitive fields only comes back from
`GET /api/admin/employees/:id`, shown next.

## 2. Get one employee

```sh
curl -s "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .
```

Super Admin gets the detailed response (gender/religion/birth date/place
included). Database Admin and Viewer get the basic response, sensitive
fields come back `undefined`.

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
  -d '{ "building": "South Wing" }' | jq .
```

There's no `assigned_class` field on Employee. A homeroom teacher
assignment is tracked the other way around, on the `Class` side
(`homeroom_teacher_id`), not as a field on Employee. See
`bun test src/test/class.test.ts` for that flow.

Setting `status` to `RESIGNED` without `resignation_date` gets rejected:

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

`last_working_date` and `notes` (shown under `offboarding` in the
response) work the same way, on create or update:

```sh
curl -s -X PATCH "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "last_working_date": "2026-06-30T00:00:00.000Z", "notes": "Handover completed" }' | jq .
```

### Identifier edit lock (NIK / NPWP / BPJS / Bank account)

Once one of these four fields has a value, overwriting it with a different
value only works within 1 hour of the employee record's `created_at`.
Fraud-prevention gate. Filling in a field that was left blank at creation
doesn't count as overwriting, so that's never blocked. No override either,
not even for Super Admin. Past the window the only fix is soft-delete and
recreate.

Right after the seed/create in section 1, `$EMPLOYEE_ID` is brand new, so
an overwrite here still works:

```sh
curl -s -X PATCH "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "nik": "2222222222222222" }' | jq .
# -> 200
```

To see the block actually fire without waiting an hour, backdate
`created_at` on that employee first:

```sh
# unquoted heredoc (<<EOF, not <<'EOF') so $EMPLOYEE_ID actually interpolates
bunx prisma db execute --stdin <<EOF
UPDATE employees SET created_at = created_at - interval '2 hours' WHERE id = '$EMPLOYEE_ID';
EOF

curl -s -X PATCH "$BASE/api/admin/employees/$EMPLOYEE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "nik": "3333333333333333" }' | jq .
# -> 400 "NIK/NPWP/BPJS/Bank account can only be changed within 1 hour of
#    the record's creation. Soft-delete and recreate the record instead."
```

The blocked attempt gets written to `AuditLog` with `action:
UNAUTHORIZED_ACCESS`, same as a blocked office-hours write below.

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

> Why `Content-Type` matters here even with no body: Hono's `csrf()`
> middleware (`web.ts`) treats a missing `Content-Type` as `text/plain`,
> flags it as a possible form submission, and blocks it unless the request
> carries an `Origin`/`Sec-Fetch-Site` header proving it's same-origin. A
> real browser sends those automatically. curl/Postman without explicit
> headers doesn't, so a bare `curl -X PATCH .../delete/:id` gets a `403`.
> Always send `Content-Type: application/json` on mutating calls, even
> bodyless ones, when testing by hand.

Restore only works from the trash bin. Try it again and you'll get `400
"Employee is not in the trash bin. It might be active or permanently
deleted."`.

## 6. Permission boundaries

The seed script also creates a Database Admin and a Viewer, both scoped to
the same unit as `$ADMIN_TOKEN`, plus a second employee (`$EMPLOYEE_2_ID`)
living in a different unit (`DEV_UNIT_2`) so cross-unit blocking is
actually demonstrable instead of just described.

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

`can_write_data` is a separate gate on top of unit scope. The seeded
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
account, gets rejected with `400`. Every change is written to `AuditLog`
with `action: PERMISSION_CHANGE`.

### Office-hours write gate

Even with `can_write_data: true`, a `DATABASE_ADMIN`'s create/update calls
only succeed 06:30-17:00 WIB. `SUPER_ADMIN` is never subject to this. The
point is a compromised Database Admin account can't be used to quietly
alter data at night when nobody's likely to notice. Blocked attempts get
written to `AuditLog` with `action: UNAUTHORIZED_ACCESS`.

Saturday defaults to a normal working day (`SATURDAY_DEFAULT_ACTIVE` unset,
or explicitly `"true"`), so Super Admin isn't stuck toggling every Saturday
by hand while it's still unclear how often that's actually needed. Set
`SATURDAY_DEFAULT_ACTIVE=false` for the stricter mode: Saturday off by
default, working only on dates a Super Admin has explicitly designated
below. Sunday is always off either way. No code change or migration needed
to flip modes, just the env var.

**Working Saturdays** (only meaningful once `SATURDAY_DEFAULT_ACTIVE=false`;
Super Admin only, date must actually be a Saturday):

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "date": "2026-08-15T00:00:00.000Z", "reason": "Makeup day" }' \
  "$BASE/api/admin/working-days" | jq .

curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/working-days" | jq .
curl -s -X DELETE -H "Cookie: access_token=$ADMIN_TOKEN" \
  "$BASE/api/admin/working-days/<id>"
```

**Emergency after-hours exception** (Super Admin only, max 240 minutes / 4
hours, auto-expires, no in-app request/approval workflow, coordinate out
of band e.g. by phone):

```sh
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "minutes": 120 }' \
  "$BASE/api/admin/admin-users/grant-after-hours/$DB_ADMIN_ID" | jq .
```

While the grant is active, that Database Admin's writes succeed regardless
of the time. `OFFICE_HOURS_START`/`OFFICE_HOURS_END` (default `06:30`/
`17:00`) are configurable via env vars, no redeploy needed.

## 7. Internal API (used by other apps, e.g. Daily Check-in / MTSS)

Token-based, scoped, separate from the admin-panel cookie auth:

```sh
curl -s -H "Authorization: Bearer $API_TOKEN" \
  "$BASE/api/internal/employees/lookup?email=budi.santoso@millennia21.id" | jq .
```

Every call here, success or not-found, gets written to `AuditLog` with
`action: API_ACCESS` and the calling `api_client_id`, and bumps that
client's `last_used_at`. A revoked or wrong-scope token gets `401`/`403`
instead of leaking anything.

## 8. Where the rest of the picture is

- Every rule above, plus every edge case (invalid enums, missing fields,
  cross-unit transfer attempts, revoked API clients, etc.): `bun test
  src/test/employee.test.ts` and `bun test src/test/error-middleware.test.ts`.
- Who changed what, when: `AuditLog` rows written on every
  create/update/delete/restore, with before/after snapshots. Query via
  Prisma Studio (`bunx prisma studio`) or directly against the
  `audit_logs` table.
