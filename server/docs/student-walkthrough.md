# Student Module API Walkthrough

Manual, copy-pasteable walkthrough of the Student module and everything
attached to a student record: enrollment/academic history, Parent/Guardian,
Consent (+ attachment upload), Health Record, Health Note, Vaccine Record,
and PC Activity.

Class/Grade/Academic Year themselves (as standalone entities, not the
student-specific enrollment action) are covered in
`docs/academic-class-walkthrough.md`. This doc only shows the student-side
of that relationship: enrolling an already-existing student into an
already-existing class.

For the rigorous picture (every edge case, with assertions), run
`bun test src/test/student.test.ts src/test/enrollment.test.ts
src/test/parent-guardian.test.ts src/test/consent.test.ts
src/test/consent-attachment.test.ts src/test/health-record.test.ts
src/test/health-note.test.ts src/test/vaccine-record.test.ts
src/test/pc-activity.test.ts` instead. This doc is just for getting a feel
for the API without reading code.

## Table of contents

0. Setup
1. Create a student
2. Enrollment / academic history
3. Parent / Guardian
4. Consent + attachment upload
5. Health: record, notes, vaccines
6. PC Activity
7. Search and filter
8. Sensitive data visibility by role
9. Soft-delete, trash bin, restore
10. Permission boundaries
11. Where the rest of the picture is

## 0. Setup

```sh
cd server
bun run seed:dev:student
bun run seed:dev:student:clean # clear all data after running this walkthrough
bun run dev   # in a separate terminal, http://localhost:3000
```

Self-contained. Doesn't require `seed:dev:employee` or `seed:dev:academic`
to have run first. It creates its own dedicated Grade/Class/Academic Year
(status `UPCOMING`, same reasoning as `seed/dev-data-academic.ts`: never
collides with the single-active-year constraint), a teacher employee to
use as a PC Activity mentor, and four admin accounts.

Copy the printed `--- Copy-paste to set up your shell ---` block verbatim.
It has every `export ...` line this doc needs: `BASE`, `ADMIN_TOKEN`,
`DB_ADMIN_TOKEN`, `VIEWER_TOKEN`, `VIEWER_SENSITIVE_TOKEN`, `STUDENT_ID`,
`GRADE_ID`, `CLASS_ID`, `ACADEMIC_YEAR_ID`, `TEACHER_EMPLOYEE_ID`.

Two Viewer accounts get seeded on purpose:

- `VIEWER_TOKEN`: plain Viewer, `can_view_sensitive_data: false`.
- `VIEWER_SENSITIVE_TOKEN`: same role, `can_view_sensitive_data: true`.

There's no API endpoint that grants this flag (unlike `can_write_data`,
which has `PATCH .../can-write-data/:id`), so the seed sets it directly in
the DB. Section 8 uses both tokens side by side to show what the flag
actually changes.

The seeded student is deliberately **not enrolled**: `current_class_id` is
`null`. Section 2 enrolls them live so you see the before/after instead of
a pre-baked state.

## 1. Create a student

```sh
curl -s -X POST "$BASE/api/admin/students" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{
    "full_name": "Elara Voss",
    "nick_name": "Elara",
    "email": "elara.voss@millennia21.id",
    "gender": "FEMALE",
    "religion": "ISLAM",
    "birth_place": "Bandung",
    "birth_date": "2016-03-10T00:00:00.000Z",
    "nis": "2600001",
    "nisn": "2600000001",
    "current_grade_id": "'"$GRADE_ID"'",
    "join_grade_id": "'"$GRADE_ID"'",
    "join_academic_year_id": "'"$ACADEMIC_YEAR_ID"'"
  }' | tee /tmp/student2.json | jq .

export STUDENT_2_ID=$(jq -r .data.id /tmp/student2.json)
```

`email` has to end with `@$ALLOWED_DOMAIN` (`millennia21.id` in `.env`),
same rule as Employee. `nis` must be exactly 7 digits, `nisn` exactly 10 if
given. Run it twice with the same `nis`/`nisn`/`email` and you get a clean
`400 "NIS already registered"` / `"NISN already registered"` /
`"Email already registered"` instead of a raw DB error.

`gender`, `religion`, `birth_place`, `birth_date`, and `photo_url` are
Super-Admin-only, same tier as Employee's equivalents. They come back
`undefined` for Database Admin and Viewer.

### NIS / NISN edit lock

Overwriting an already-set `nis` or `nisn` with a different value only
works within 1 hour of the student record's `created_at`, same
fraud-prevention mechanism as Employee's NIK/NPWP/BPJS/bank account.
Filling in a value that was left blank at creation doesn't count as
overwriting, so that's never blocked.

Unlike Employee's identifier lock, there is currently **no additional
Super-Admin-only restriction** here: any Database Admin with
`can_write_data` can change a student's NIS/NISN within that 1-hour window,
same as Super Admin. This is a deliberate choice for now, not an oversight:
requiring escalation to Super Admin for a same-day typo fix was judged
worse than the small risk window.

```sh
curl -s -X PATCH "$BASE/api/admin/students/$STUDENT_2_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$DB_ADMIN_TOKEN" \
  -d '{ "nisn": "2600000009" }' | jq .
# -> 200, succeeds for Database Admin too, still inside the grace period
```

Backdating `created_at` to see the block fire works the same way as the
Employee walkthrough's identifier-lock demo (`bunx prisma db execute`).

## 2. Enrollment / academic history

The seeded student isn't enrolled yet. Enroll them into the seeded class:

```sh
curl -s -X POST "$BASE/api/admin/students/$STUDENT_ID/enrollments" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "class_id": "'"$CLASS_ID"'", "academic_year_id": "'"$ACADEMIC_YEAR_ID"'" }' | tee /tmp/enroll.json | jq .

export ENROLLMENT_ID=$(jq -r .data.id /tmp/enroll.json)
```

`academic_year_id` is passed explicitly here because the seeded year is
`UPCOMING`, not `ACTIVE` (see section 0). Leave it out and the service
resolves to whichever year is currently `ACTIVE` instead, which won't match
the seeded `$CLASS_ID`'s year and will fail the grade-matching check below.

This does two things at once: creates the `StudentClassEnrollment` row,
and updates `Student.current_class_id` to `$CLASS_ID` as a side effect.
Confirm it:

```sh
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID" \
  | jq '.data.academic.current_class_id'
# -> "$CLASS_ID", was null before
```

The class you enroll into has to match the student's current grade (the
service checks `class.grade_id === student.current_grade_id`). View the
full history, including past enrollments after a promote/transfer:

```sh
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/enrollments" | jq .
```

Promote (moves to a new grade/class/year), transfer (moves to a different
class within the same year), and close (mark `TRANSFERRED` or
`WITHDRAWN`) all work on an existing enrollment ID. See
`docs/academic-class-walkthrough.md` for how to create the additional
Class/Grade rows those need, and `bun test src/test/enrollment.test.ts` for
every rule (capacity limits, force-override, race conditions).

## 3. Parent / Guardian

A student can have more than one contact. List the two seeded ones:

```sh
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq .
export PARENT_ID=$(curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq -r '.data[0].id')
```

Add a third:

```sh
curl -s -X POST "$BASE/api/admin/students/$STUDENT_ID/parents" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "type": "GUARDIAN", "full_name": "Kael Sorenson", "phone": "081211112222", "email": "kael.sorenson@mws-dev.local", "is_primary": false }' | jq .
```

`phone` gets normalized the same way as Employee's `mobile_phone`:
whatever you type (`08xx`, `+628xx`, `628xx`) is stored as `628xx`.

```sh
curl -s -X PATCH "$BASE/api/admin/students/$STUDENT_ID/parents/$PARENT_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "phone": "081200000000" }' | jq .
# -> stored as "6281200000000"
```

`phone`/`email`/`address` are the sensitive-tier fields here. Section 8
shows exactly who can see them.

## 4. Consent + attachment upload

```sh
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/consents" | jq .
export MEDIA_CONSENT_ID=$(curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/consents" | jq -r '.data[] | select(.consent_type=="MEDIA_CONSENT") | .id')
```

Two are seeded: `MEDIA_CONSENT` (`SIGNED`) and `PARENT_CONSENT`
(`PENDING`). Only one record per `consent_type` per student, enforced by a
partial unique index (soft-deleted ones don't count).

Uploading a signed copy needs a real file (PDF/JPEG/PNG only) and requires
`can_view_sensitive_data`, same gate as viewing one:

```sh
curl -s -X POST "$BASE/api/admin/students/$STUDENT_ID/consents/$MEDIA_CONSENT_ID/attachments" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -H "Origin: http://localhost:5173" \
  -F "file=@/path/to/signed-consent.pdf" | jq .

export ATTACHMENT_ID=$(curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/consents/$MEDIA_CONSENT_ID/attachments" | jq -r '.data[0].id')
```

> Why the `Origin` header is needed here, on top of `Content-Type`: a
> multipart form upload is one of the content types Hono's `csrf()`
> middleware treats as a possible cross-site form submission (same
> category as missing `Content-Type`, see the Employee walkthrough's note
> in section 5). curl doesn't send `Origin` by default, so without it the
> request gets a bare `403 "Forbidden"` from the CSRF layer before it ever
> reaches the app. `http://localhost:5173` is one of the origins
> `web.ts` allows.

An unrecognized file type is rejected before it ever reaches MinIO:

```sh
curl -s -X POST "$BASE/api/admin/students/$STUDENT_ID/consents/$MEDIA_CONSENT_ID/attachments" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -H "Origin: http://localhost:5173" \
  -F "file=@/path/to/notes.txt" | jq .
# -> 400 "Unsupported or unrecognized file type. Allowed types: PDF, JPEG, PNG."
```

Download and read the list the same way, with the same
`can_view_sensitive_data` gate:

```sh
curl -s -o /tmp/downloaded.pdf -w "%{http_code} %{content_type}\n" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  "$BASE/api/admin/students/$STUDENT_ID/consents/$MEDIA_CONSENT_ID/attachments/$ATTACHMENT_ID/download"

curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: access_token=$VIEWER_TOKEN" \
  "$BASE/api/admin/students/$STUDENT_ID/consents/$MEDIA_CONSENT_ID/attachments"
# -> 403 "Forbidden: You don't have permission to access sensitive data"
```

## 5. Health: record, notes, vaccines

Three separate things, all gated by `can_view_sensitive_data` (whole
resource, not field-level like Parent/Guardian's contact fields):

```sh
# one record per student
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/health-record" | jq .

# many notes, categorized HEALTH_INFO or SPECIAL_NEEDS
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/health-notes" | jq .

# many vaccine records, one per VaccineType
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/vaccine-records" | jq .

# Viewer without the flag is blocked from all three the same way
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: access_token=$VIEWER_TOKEN" \
  "$BASE/api/admin/students/$STUDENT_ID/health-record"
# -> 403
```

Every read here is audit-logged with `action: ACCESS_HEALTH_DATA`, per
spec's requirement that health data access always leaves a trail,
independent of whether the read succeeds or gets denied.

## 6. PC Activity

Not sensitive-gated. Any admin role that can read the student can read
their PC Activity schedule:

```sh
curl -s -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/pc-activities" | jq .
```

Two are seeded: `MONDAY` "Basketball" (mentor: `$TEACHER_EMPLOYEE_ID`) and
`TUESDAY` "Coding Club" (no mentor). `mentor_id` is optional, but if given
must be an active employee whose job level is teaching-eligible:

```sh
curl -s -X PATCH "$BASE/api/admin/students/$STUDENT_ID/pc-activities/<activity-id>" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "mentor_id": "some-non-teaching-employee-id" }' | jq .
# -> 400 "Invalid mentor: referenced employee does not exist, is not active,
#    or does not hold a teaching-eligible job level"
```

Only 4 days exist (`MONDAY`-`THURSDAY`), one activity per student per day
per academic year. See `bun test src/test/pc-activity.test.ts` for the
full set of edge cases (soft-deleted mentors, mentor eligibility on
update, clearing a mentor via `mentor_id: null`, DATABASE_ADMIN
office-hours gating).

## 7. Search and filter

```sh
# free-text: matches full_name/nick_name/email/nis/nisn, AND parent full_name/phone/email
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students?search=Fiel%20Nilvalen" | jq -c '.data[] | .identity.full_name'

# filters
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students?consent_status=SIGNED" | jq .
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students?pc_activity_day=MONDAY" | jq .
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students?leave_year=2025" | jq .
```

Parent-phone search is flexible about the prefix. After section 3's
update, the father's phone is stored as `6281200000000` (normalized on
write, same as create). All three forms find him:

```sh
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students?search=081200000000" | jq -c '.data[] | .identity.full_name'
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students?search=6281200000000" | jq -c '.data[] | .identity.full_name'
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" --data-urlencode "search=+6281200000000" -G "$BASE/api/admin/students" | jq -c '.data[] | .identity.full_name'
# all three -> the same student
```

The server normalizes the search term the same way it normalizes phone
input on create/update (`08xx`/`+62xx`/`62xx` all become `62xx`) before
running the `contains` match, so it doesn't matter which form you type. A
search term with no digits at all (a name search) skips this entirely,
it's not turned into an empty pattern that would match every row.

This is a plain substring match, not a prefix match: a fragment from the
middle or end of the number matches too, e.g. `search=1200000` finds the
same parent.

`081200000000` and `6281200000000` share no substring across the prefix,
so the leading-0 form never matches once a number has gone through
normalization. Search using the `62`-prefixed form, or a distinctive tail
of the digits that excludes the prefix entirely, e.g. `search=1200000000`.

## 8. Sensitive data visibility by role

Three different tiers exist on the student side, and they don't all use
the same mechanism:

| Data | Who sees it | Mechanism |
|---|---|---|
| `gender`/`religion`/`birth_place`/`birth_date`/`photo_url` | Super Admin only | hard role check, `StudentDetailResponse` |
| Parent `phone`/`email`/`address` | Super Admin, or anyone with `can_view_sensitive_data` | `canViewSensitiveData()`, field-level, rest of the record still visible |
| Health record/notes/vaccines, consent attachments | Super Admin, or anyone with `can_view_sensitive_data` | `assertCanViewSensitiveData()`, whole-resource block |

The seed's two Viewer accounts make the middle and bottom rows directly
comparable:

```sh
curl -s -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq -c '.data[0]'
# -> no phone/email/address keys at all (not null, just absent)

curl -s -H "Cookie: access_token=$VIEWER_SENSITIVE_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq -c '.data[0]'
# -> phone/email/address present
```

This is different from Employee, where `mobile_phone`/`residential_address`
are gated by a plain role check (Viewer excluded, Database Admin always
included, no flag involved). Student-side sensitive data uses the flag
because the underlying rule ("not sensitive unless not granted access") is
explicitly about per-account grants, not a fixed role tier. See spec
section 5.3 and 15 for the wording this maps to.

## 9. Soft-delete, trash bin, restore

Same shape as Employee, Super Admin only:

```sh
curl -s -X PATCH "$BASE/api/admin/students/delete/$STUDENT_ID" \
  -H "Content-Type: application/json" -H "Cookie: access_token=$ADMIN_TOKEN" | jq .

curl -s "$BASE/api/admin/students?is_deleted=true" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .

curl -s -X PATCH "$BASE/api/admin/students/restore/$STUDENT_ID" \
  -H "Content-Type: application/json" -H "Cookie: access_token=$ADMIN_TOKEN" | jq .
```

`Content-Type: application/json` is required even on these bodyless
calls, same CSRF reason as Employee section 5. Database Admin gets
`403 "Forbidden: Only Super Admin can restore student data"` if they try
either endpoint.

Every child resource (parents, consents, health data, PC activities,
enrollments) has its own independent soft-delete/restore, following the
same pattern. `bun test` for each of them covers the "already deleted" /
"not in the trash bin" edge cases.

## 10. Permission boundaries

```sh
# Viewer can read...
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: access_token=$VIEWER_TOKEN" \
  "$BASE/api/admin/students/$STUDENT_ID"
# -> 200

# ...but every write is blocked
curl -s -X PATCH -H "Content-Type: application/json" \
  -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/students/$STUDENT_ID" \
  -d '{ "previous_school": "Nope" }' | jq .
# -> 403 "Forbidden: Viewer cannot update data"
```

Unlike Employee, student reads are **not scoped by unit**. Any admin role
(Viewer, Database Admin, or Super Admin) from any unit can read any
student. This is confirmed deliberate: `MasterUnit` in the schema only
relates to `Employee`/`AdminUser`, there's no relation from a Unit to
Grade/Class/Student at all, so a student isn't structurally tied to any
particular unit the way an employee is. `can_write_data` and office-hours
gating for Database Admin still apply the same way as Employee, see that
walkthrough's section 6 for the full grant/revoke/emergency-exception
flow, it isn't repeated here.

## 11. Where the rest of the picture is

- Every rule above, plus every edge case: `bun test
  src/test/student.test.ts src/test/enrollment.test.ts
  src/test/parent-guardian.test.ts src/test/consent.test.ts
  src/test/consent-attachment.test.ts src/test/health-record.test.ts
  src/test/health-note.test.ts src/test/vaccine-record.test.ts
  src/test/pc-activity.test.ts`.
- Who changed what, when: `AuditLog` rows on every create/update/delete/
  restore across all of the above, with before/after snapshots. Query via
  Prisma Studio (`bunx prisma studio`) or directly against the
  `audit_logs` table.
