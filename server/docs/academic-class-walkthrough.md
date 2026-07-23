# Academic Year / Class / Grade / Master Data API Walkthrough

Manual, copy-pasteable walkthrough of the Academic Year, Class, Grade, and
master-data (Unit / Job Position / Job Level) modules. Everything not
covered by `docs/employee-walkthrough.md`.

For the rigorous picture (every edge case, with assertions), run
`bun test src/test/academic-year.test.ts src/test/class.test.ts
src/test/grade.test.ts src/test/job-level.test.ts
src/test/simple-master-data.test.ts` instead. This doc is just for getting
a feel for the API without reading code.

## 0. Setup

```sh
cd server
bun run seed:dev:academic
bun run seed:dev:academic:clean # clear all data after running this walkthrough
bun run dev   # in a separate terminal, http://localhost:3000
```

Just `package.json` shortcuts for `bun run seed/dev-data-academic.ts` (with
or without `--clean`). Raw path still works if you'd rather type that out.

This seed script is independent from `seed/dev-data-employee.ts`. It
creates its own dedicated Unit/Job Position/Job Level/Super Admin/Employees
instead of assuming the Employee seed has already run, so either script
works alone, in any order, against a fresh DB.

It prints a `--- Copy-paste to set up your shell ---` block. Copy it
verbatim, it has every `export ...` line this doc needs (`BASE`,
`ACADEMIC_ADMIN_TOKEN`, `ACADEMIC_UNIT_ID`, `ACADEMIC_POSITION_ID`,
`TEACHER_LEVEL_ID`, `STAFF_LEVEL_ID`, `TEACHER_EMPLOYEE_ID`,
`STAFF_EMPLOYEE_ID`, `ACADEMIC_YEAR_ID`, `GRADE_ID`).

Two employees get seeded specifically to demonstrate the homeroom-teacher
eligibility rule:

- Teacher (`$TEACHER_EMPLOYEE_ID`): job level `is_teaching_role: true`, can
  be assigned as a homeroom teacher.
- Staff (`$STAFF_EMPLOYEE_ID`): job level `is_teaching_role: false`, gets
  rejected if you try.

`$GRADE_ID` is a lookup of the real, permanently-seeded "Grade 1" row (see
section 3). Grade has no CRUD API, so there's nothing to create there.

## 1. Master data: Unit, Job Position, Job Level

`MasterUnit` and `MasterJobPosition` are plain `{ name }` CRUD, served by
the same generic factory. `MasterJobLevel` additionally has
`is_teaching_role` (used later to decide who's eligible as a Class's
homeroom teacher), so it has its own dedicated service, but the same shape
of endpoints.

```sh
# create
curl -s -X POST -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "name": "Demo Unit" }' \
  "$BASE/api/admin/units" | tee /tmp/unit.json | jq .
export DEMO_UNIT_ID=$(jq -r .data.id /tmp/unit.json)

# list / search / sort / paginate
curl -s "$BASE/api/admin/units?search=Demo&sort_by=name&sort_order=asc" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" | jq .

# update
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "name": "Demo Unit Renamed" }' \
  "$BASE/api/admin/units/$DEMO_UNIT_ID" | jq .

# delete   Content-Type is required here even with no body, see note below
curl -s -X DELETE -H "Content-Type: application/json" -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  "$BASE/api/admin/units/$DEMO_UNIT_ID" | jq .
```

> Why `Content-Type` matters here even with no body: same reason as the
> Employee soft-delete call in `docs/employee-walkthrough.md` section 5.
> Hono's `csrf()` middleware treats a missing `Content-Type` as `text/plain`
> and blocks it unless the request looks same-origin. Always send
> `Content-Type: application/json` on mutating calls, even bodyless ones,
> when testing by hand.

Same 5 endpoints, same shape, for `/api/admin/job-positions` and
`/api/admin/job-levels` (the latter also accepts/returns
`is_teaching_role`):

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "name": "Demo Level", "is_teaching_role": true }' \
  "$BASE/api/admin/job-levels" | jq .
```

All four (`units`, `job-positions`, `job-levels`, and Grade below) are
Super Admin only for create/update/delete. Every admin role can read.
Deleting one that's still referenced (e.g. a Unit with employees in it, or
a Job Level with employees at that level) gets rejected:

```sh
curl -s -X DELETE -H "Content-Type: application/json" -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  "$BASE/api/admin/units/$ACADEMIC_UNIT_ID" | jq .
# -> 400 "Cannot delete: this unit is still referenced by 2 employee(s),
#    1 admin user(s). Reassign or remove those first."
```

## 2. Academic Year

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "name": "Demo Year 2027/2028", "start_date": "2027-07-01T00:00:00.000Z", "end_date": "2028-06-30T00:00:00.000Z" }' \
  "$BASE/api/admin/academic-years" | tee /tmp/year.json | jq .
export DEMO_YEAR_ID=$(jq -r .data.id /tmp/year.json)
```

Defaults to `status: "UPCOMING"` if omitted. Only one academic year can be
`"ACTIVE"` at a time, enforced both in the service (a clear error message)
and by a database constraint, so it holds even under concurrent requests:

```sh
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "status": "ACTIVE" }' \
  "$BASE/api/admin/academic-years/$DEMO_YEAR_ID" | jq .
# -> 200, since $ACADEMIC_YEAR_ID (seeded UPCOMING) isn't ACTIVE

curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "status": "ACTIVE" }' \
  "$BASE/api/admin/academic-years/$ACADEMIC_YEAR_ID" | jq .
# -> 400 "Another academic year is already active. Complete or reassign it
#    before activating this one."
```

Deleting a year still referenced by a Class, a student's join-year, or an
enrollment gets rejected the same way as the master-data delete-guards
above.

## 3. Grade

No CRUD here. Grade is fixed reference data (Kindergarten Pre-K/K1/K2,
Grade 1-9), seeded once via migration. Unit/Job Position/Job Level used to
be conceptually similar but aren't in practice, since those genuinely
change over time. Read-only:

```sh
curl -s "$BASE/api/admin/grades?size=20" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" | jq '.data[] | {name, level}'

curl -s "$BASE/api/admin/grades/$GRADE_ID" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" | jq .
```

## 4. Class

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{
    "name": "1 Fuji",
    "grade_id": "'"$GRADE_ID"'",
    "academic_year_id": "'"$ACADEMIC_YEAR_ID"'",
    "homeroom_teacher_id": "'"$TEACHER_EMPLOYEE_ID"'"
  }' \
  "$BASE/api/admin/classes" | tee /tmp/class.json | jq .
export CLASS_ID=$(jq -r .data.id /tmp/class.json)
```

A class name only needs to be unique within its academic year. The same
name is fine in a different year. This is exactly what happens across
academic years in practice, e.g. last year's "Andromeda" vs this year's "1
Fuji" theme. Each is its own `Class` row scoped to its own year, so
historical data never gets mixed up across a rename.

`homeroom_teacher_id` must be a currently active employee whose job level
is teaching-eligible (`is_teaching_role: true`):

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "name": "1 Rinjani", "grade_id": "'"$GRADE_ID"'", "academic_year_id": "'"$ACADEMIC_YEAR_ID"'", "homeroom_teacher_id": "'"$STAFF_EMPLOYEE_ID"'" }' \
  "$BASE/api/admin/classes" | jq .
# -> 400 "Invalid homeroom teacher: referenced employee does not exist,
#    is not active, or does not hold a teaching-eligible job level"
```

One employee can be homeroom teacher of at most one class per academic
year (also enforced both in the service and by a database constraint):

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "name": "1 Bromo", "grade_id": "'"$GRADE_ID"'", "academic_year_id": "'"$ACADEMIC_YEAR_ID"'", "homeroom_teacher_id": "'"$TEACHER_EMPLOYEE_ID"'" }' \
  "$BASE/api/admin/classes" | jq .
# -> 400 "This employee is already the homeroom teacher of another class
#    in this academic year."
```

Search/filter/sort:

```sh
curl -s "$BASE/api/admin/classes?academic_year_id=$ACADEMIC_YEAR_ID&sort_by=grade_level&sort_order=asc" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" | jq .
```

Deleting a class still referenced by a current student or an enrollment
gets rejected the same way as the other delete-guards above.

## 5. Homeroom teacher assignment history

`Class.homeroom_teacher_id` only holds the current homeroom teacher. Every
assignment, past and present, is kept in a separate history table, so
reassigning a class never loses the record of who taught it before:

```sh
# reassign, closes the current assignment and opens a new one
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" \
  -d '{ "homeroom_teacher_id": null }' \
  "$BASE/api/admin/classes/$CLASS_ID" | jq .

curl -s "$BASE/api/admin/classes/$CLASS_ID/homeroom-history" \
  -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" | jq .
# -> one row, end_date now set (closed). The class currently has no
#    homeroom teacher assigned
```

Readable by every admin role, same as `GET .../:id`.

## 6. Where the rest of the picture is

- Every rule above, plus every edge case (invalid enums, missing fields,
  race-condition safety nets, RBAC per role, delete-guards for every
  reference type): `bun test src/test/academic-year.test.ts
  src/test/class.test.ts src/test/grade.test.ts
  src/test/job-level.test.ts src/test/simple-master-data.test.ts`.
- Who changed what, when: `AuditLog` rows written on every
  create/update/delete, with before/after snapshots. Query via Prisma
  Studio (`bunx prisma studio`) or directly against the `audit_logs`
  table. Academic Year, Class, and Grade/Unit/Job Position/Job Level
  mutations use `CREATE_ACADEMIC_YEAR`/`UPDATE_ACADEMIC_YEAR`/
  `DELETE_ACADEMIC_YEAR`, `CREATE_CLASS`/`UPDATE_CLASS`/`DELETE_CLASS`, and
  the generic `CREATE_MASTER_DATA`/`UPDATE_MASTER_DATA`/`DELETE_MASTER_DATA`
  (`entity_type` distinguishes which table) respectively.
