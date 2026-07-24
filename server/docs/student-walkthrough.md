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
src/test/pc-activity.test.ts src/test/student-api.test.ts` instead. This
doc is just for getting a feel for the API without reading code.

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
9. Audit trail: atomic writes and unauthorized-access tracking
10. Soft-delete, trash bin, restore
11. Permission boundaries
12. Internal API (server-to-server)
13. Where the rest of the picture is

## 0. Setup

### Local dev

```sh
cd server
bun run seed:dev:student
bun run seed:dev:student:clean # clear all data after running this walkthrough
bun run dev   # in a separate terminal, http://localhost:3000
```

Just `package.json` shortcuts for `bun run seed/dev-data-student.ts` (with
or without `--clean`). Raw path still works if you'd rather type that out.

Self-contained. Doesn't require `seed:dev:employee` or `seed:dev:academic`
to have run first. It creates its own dedicated Grade/Class/Academic Year
(status `UPCOMING`, same reasoning as `seed/dev-data-academic.ts`: never
collides with the single-active-year constraint), a teacher employee to
use as a PC Activity mentor, and four admin accounts.

### Against a deployed stack (e.g. Komodo)

1. In Komodo, open a terminal into the `mws-server` container.
2. Run the seed script there, pointing `SEED_BASE_URL` at a host/port you
   can reach from your own machine (e.g. the VPS IP + the port mapped to
   3000, `3010` in `docker-compose.yml`):

   ```sh
   SEED_BASE_URL=http://<reachable-host>:3010 bun run seed:dev:student
   ```

3. Copy the `--- Copy-paste to set up your shell ---` block it prints into
   your own terminal (laptop, not inside the container).
4. Every `curl` example in sections 1-13 below works as-is from there.
5. Clean up from inside the container when done:
   `bun run seed:dev:student:clean`.

### Either way

Copy the printed `--- Copy-paste to set up your shell ---` block verbatim.
It has every `export ...` line this doc needs: `BASE`, `ADMIN_TOKEN`,
`DB_ADMIN_TOKEN`, `VIEWER_TOKEN`, `VIEWER_SENSITIVE_TOKEN`, `STUDENT_ID`,
`GRADE_ID`, `CLASS_ID`, `ACADEMIC_YEAR_ID`, `TEACHER_EMPLOYEE_ID`.

Two Viewer accounts get seeded on purpose:

- `VIEWER_TOKEN`: plain Viewer, `can_view_sensitive_data: false`.
- `VIEWER_SENSITIVE_TOKEN`: same role, `can_view_sensitive_data: true`.

The seed sets `VIEWER_SENSITIVE_TOKEN`'s flag directly in the DB for
convenience (there's also a live endpoint for it, see section 8). Section
8 uses both tokens side by side to show what the flag actually changes.

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

`gender` and `religion` are always visible regardless of role, spec's
sensitive-data list (section 15) doesn't mention either one. `birth_place`,
`birth_date`, and `photo_url` do follow the `can_view_sensitive_data` gate
from section 8. See that section for the full picture.

### Student status lifecycle

Every new student starts `REGISTERED`, no matter what you pass. Trying to
create one directly as `ACTIVE` is rejected:

```sh
curl -s -X POST "$BASE/api/admin/students" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{
    "full_name": "Test Reject",
    "nick_name": "Reject",
    "email": "test.reject@millennia21.id",
    "nis": "2600099",
    "current_grade_id": "'"$GRADE_ID"'",
    "join_grade_id": "'"$GRADE_ID"'",
    "join_academic_year_id": "'"$ACADEMIC_YEAR_ID"'",
    "status": "ACTIVE",
    "religion": "ISLAM",
    "gender": "MALE",
    "birth_place": "Bandung",
    "birth_date": "2016-03-10T00:00:00.000Z"
  }' | jq .
# -> 400 "New students must start as REGISTERED and become ACTIVE after
#    class enrollment"
```

`REGISTERED` means the student has a valid profile and NIS but isn't tied
to a class yet. The only way to `ACTIVE` is a valid class enrollment
(section 2 does this for `$STUDENT_2_ID`), never a direct `PATCH status`:

```sh
curl -s -X PATCH "$BASE/api/admin/students/$STUDENT_2_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "status": "ACTIVE" }' | jq .
# -> 400 "An active student must have an active class enrollment"
```

Moving to `GRADUATED` requires both `leave_year` and `graduation_grade` in
the same request, not as a follow-up patch. Doesn't require ever having
been `ACTIVE` (uses `$STUDENT_2_ID` here so `$STUDENT_ID` stays untouched
for section 2's enrollment demo):

```sh
curl -s -X PATCH "$BASE/api/admin/students/$STUDENT_2_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "status": "GRADUATED" }' | jq .
# -> 400 "Graduated students require leave_year and graduation_grade"

curl -s -X PATCH "$BASE/api/admin/students/$STUDENT_2_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "status": "GRADUATED", "leave_year": "2026", "graduation_grade": "DEV_STUDENT_GRADE" }' | jq .
# -> 200, "status": "GRADUATED"
```

`WITHDRAWN`/`TRANSFERRED` aren't set by hand either in the normal flow,
closing a student's last active enrollment sets them automatically. See
section 2.

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

This does three things at once: creates the `StudentClassEnrollment` row,
updates `Student.current_class_id` to `$CLASS_ID`, and (since the student
was `REGISTERED`) flips `Student.status` to `ACTIVE`. Confirm both:

```sh
curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID" \
  | jq '{ class: .data.academic.current_class_id, status: .data.status }'
# -> { "class": "$CLASS_ID", "status": "ACTIVE" }, class was null and
#    status was "REGISTERED" before
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

Closing (`PATCH .../enrollments/:id/close`) or soft-deleting the
enrollment that's currently the student's only active one reverts
`Student.status` the same way enrolling advanced it, not just the
enrollment row's own status:

- Close as `WITHDRAWN`/`TRANSFERRED` with no other active enrollment left
  → `Student.status` becomes `WITHDRAWN`/`TRANSFERRED` too, and
  `current_class_id` clears.
- Soft-delete (remove) the same enrollment → `Student.status` reverts to
  `REGISTERED` instead, since there's no terminal enrollment status to
  carry over.
- If a second active enrollment still exists (a mid-year concurrent
  enrollment case), closing or removing one leaves `Student.status` alone.

Not demoed inline here since it would leave `$STUDENT_ID` unenrolled for
the rest of this walkthrough. `bun test src/test/enrollment.test.ts` has
it under "should close an enrollment as WITHDRAWN/TRANSFERRED" and "should
soft-delete an ACTIVE enrollment and clear current_class_id when it
matches".

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
  -F "file=@docs/signed-consent.pdf" | jq .

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
  -F "file=@docs/notes.txt" | jq .
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
`TUESDAY` "Coding Club" (no mentor). Grab the Monday one's ID:

```sh
export PC_ACTIVITY_ID=$(curl -s -H "Cookie: access_token=$ADMIN_TOKEN" \
  "$BASE/api/admin/students/$STUDENT_ID/pc-activities" \
  | jq -r '.data[] | select(.day=="MONDAY") | .id')
```

`mentor_id` is optional, but if given must be an active employee whose job
level is teaching-eligible:

```sh
curl -s -X PATCH "$BASE/api/admin/students/$STUDENT_ID/pc-activities/$PC_ACTIVITY_ID" \
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

Everything sensitive on the student side uses the same mechanism, one flag
checked in different shapes. `gender`/`religion` are deliberately **not**
in this list, spec section 15's sensitive-data examples never mention
either one (unlike `birth_date`, which is named explicitly), so both are
visible to every role unconditionally:

| Data                                              | Who sees it                                           | Mechanism                                                               |
| ------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `birth_place`/`birth_date`/`photo_url`            | Super Admin, or anyone with `can_view_sensitive_data` | `canViewSensitiveData()`, field-level, rest of the record still visible |
| Parent `phone`/`email`/`address`                  | Super Admin, or anyone with `can_view_sensitive_data` | `canViewSensitiveData()`, field-level, rest of the record still visible |
| Health record/notes/vaccines, consent attachments | Super Admin, or anyone with `can_view_sensitive_data` | `assertCanViewSensitiveData()`, whole-resource block                    |

There's no hard `role === SUPER_ADMIN` check left anywhere on the student
side. `canViewSensitiveData(admin)` is `admin.role === SUPER_ADMIN ||
admin.can_view_sensitive_data`, so a plain Viewer with the flag set sees
exactly what Super Admin sees, and Super Admin never needs the flag set
explicitly.

The seed's two Viewer accounts, same role, only one has the flag, make
all three rows directly comparable:

```sh
curl -s -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/students/$STUDENT_ID" | jq -c '.data.identity'
# -> { full_name, nick_name, email, gender, religion }, no birth_place/
#    birth_date/photo_url keys at all (not null, just absent)

curl -s -H "Cookie: access_token=$VIEWER_SENSITIVE_TOKEN" "$BASE/api/admin/students/$STUDENT_ID" | jq -c '.data.identity'
# -> same fields plus birth_place/birth_date/photo_url

curl -s -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq -c '.data[0]'
# -> no phone/email/address keys at all (not null, just absent)

curl -s -H "Cookie: access_token=$VIEWER_SENSITIVE_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq -c '.data[0]'
# -> phone/email/address present
```

There is an endpoint for setting the flag on any admin account, Super
Admin only, same shape as `can-write-data`. The seed sets
`VIEWER_SENSITIVE_TOKEN`'s flag straight in the DB for convenience, but
toggling it live works too:

```sh
export VIEWER_SENSITIVE_ID=$(curl -s -H "Cookie: access_token=$ADMIN_TOKEN" \
  "$BASE/api/admin/admin-users?search=dev.student.viewer.sensitive" \
  | jq -r '.data[0].id')

curl -s -X PATCH "$BASE/api/admin/admin-users/can-view-sensitive-data/$VIEWER_SENSITIVE_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "can_view_sensitive_data": false }' | jq .
```

This is different from Employee, where `mobile_phone`/`residential_address`
are gated by a plain role check (Viewer excluded, Database Admin always
included, no flag involved). Student-side sensitive data uses the flag
because the underlying rule ("not sensitive unless not granted access") is
explicitly about per-account grants, not a fixed role tier. See spec
section 5.3 and 15 for the wording this maps to.

## 9. Audit trail: atomic writes and unauthorized-access tracking

Every create/update/delete/restore on a student or an enrollment writes its
`AuditLog` row in the same database transaction as the mutation itself, not
as a fire-and-forget call after. If the audit write fails for any reason,
the whole transaction rolls back, the mutation never lands either. There's
no state where a student got created (or promoted, transferred, closed,
removed, restored) but the audit trail is silently missing.

`bun test src/test/student.test.ts` proves it by forcing the audit write to
throw mid-transaction and checking the person row never landed:

```sh
grep -A 40 "should roll back student creation entirely if the audit log write fails" src/test/student.test.ts
```

Separately, every blocked write attempt (Viewer trying to create/update,
Database Admin without `can_write_data`, Database Admin outside office
hours) writes its own `AuditAction.UNAUTHORIZED_ACCESS` entry, not just a
403 response. This is what a fraud/incident investigation queries against,
`AuditLog` isn't only successful changes:

```sh
curl -s -X POST "$BASE/api/admin/students" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$VIEWER_TOKEN" \
  -d '{ "full_name": "Should Fail", "email": "should.fail@millennia21.id", "nis": "2600098", "current_grade_id": "'"$GRADE_ID"'", "join_grade_id": "'"$GRADE_ID"'", "join_academic_year_id": "'"$ACADEMIC_YEAR_ID"'" }'
# -> 403 "Forbidden: Viewer cannot create data"
```

That request left a row behind. There's no `AuditLog` read endpoint yet,
query it directly (Prisma Studio, `bunx prisma studio`, or straight SQL):

```sh
docker exec mws-db psql -U root -d mws-center -c \
  "select action, new_values from audit_logs where action = 'UNAUTHORIZED_ACCESS' order by created_at desc limit 1;"
# -> new_values: {"reason": "blocked student create"}
```

## 10. Soft-delete, trash bin, restore

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

## 11. Permission boundaries

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

## 12. Internal API (server-to-server)

A separate surface at `/api/internal/students/*`, not `/api/admin/students`.
No admin cookie, no CSRF concerns, no admin role at all. Auth is a static
Bearer token belonging to an `ApiClient`, scoped to exactly the operations
that client was granted. Built for other internal services (Daily Check-in,
MTSS, Reading Buddy, Exima per spec section 14) to read student data
without going through an admin login.

Every successful response here wraps `data` in a `{ "success": true, "data":
... }` envelope, not just `{ "data": ... }` like `/api/admin/*`. Errors keep
the usual `{ "errors": "..." }` shape either way, that part didn't change.

The seed doesn't create an API client (no student-lookup use case exists
yet by default), so make one first with all four student scopes:

```sh
curl -s -X POST "$BASE/api/admin/api-clients" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "name": "Student Lookup Client", "scope_names": ["students:read", "students:academic_history:read", "students:health:read", "students:consent:read"] }' \
  | tee /tmp/student-api-client.json | jq .

export STUDENT_API_TOKEN=$(jq -r .data.token /tmp/student-api-client.json)
export STUDENT_API_CLIENT_ID=$(jq -r .data.id /tmp/student-api-client.json)
```

The token only prints once, on creation. Lost it? Rotate it (see below) or
revoke and issue a new client, don't try to recover it.

Five endpoints, gated by four scopes (`lookup` and the list endpoint share
`students:read`):

```sh
# students:read - lean profile lookup by nis or email, ACTIVE students only
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students/lookup?nis=9990001" | jq .
# -> { id, nis, nisn, full_name, nick_name, email, status, current_grade,
#      current_class }, nothing else, no parents/health/sensitive fields

# students:read - paginated list, same lean shape as lookup. Defaults to
# ACTIVE students, same posture as lookup - pass status explicitly to see
# REGISTERED/WITHDRAWN/GRADUATED. $STUDENT_2_ID was graduated back in
# section 1, so it only shows up once you ask for it by name. Also covers
# spec 14.3's "by grade"/"by class"/"by academic year" bullets, one
# endpoint with query params instead of three separate routes:
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students?current_grade_id=$GRADE_ID" | jq -c '.data | length'
# -> 1 ($STUDENT_ID, ACTIVE - $STUDENT_2_ID is GRADUATED, excluded by default)
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students?current_grade_id=$GRADE_ID&status=GRADUATED" | jq -c '.data[] | {nis, status}'
# -> {"nis":"2600001","status":"GRADUATED"} - $STUDENT_2_ID
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students?current_class_id=$CLASS_ID" | jq -c '.data | length'
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students?academic_year_id=$ACADEMIC_YEAR_ID" | jq -c '.data | length'
# academic_year_id filters through the student's active enrollment, not
# join_academic_year_id - "which year did they join" and "which year are
# they actively enrolled in" aren't the same field. `page`/`size` follow
# the same pagination shape as /api/admin/students, size capped at 100.

# students:academic_history:read - full enrollment history by student id
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students/$STUDENT_ID/academic-history" | jq .
# -> { academic_year, grade_level, class_name, enrollment_status,
#      start_date, end_date }, one entry per enrollment

# students:consent:read - status only, no attachment metadata or file access
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students/$STUDENT_ID/consent-status" | jq .
# -> [ { consent_type, status }, ... ], one entry per consent record

# students:health:read - blood type, assistance flag, active notes
curl -s -H "Authorization: Bearer $STUDENT_API_TOKEN" \
  "$BASE/api/internal/students/$STUDENT_ID/health" | jq .
# -> { blood_type, needs_assistance, notes: [ { category, description,
#      status }, ... ] }
```

`lookup` only ever returns `ACTIVE` students, a `REGISTERED` or
`WITHDRAWN` student is a 404 here even if the NIS is correct, this is a
lookup for "is this a currently enrolled student", not a general student
search. The list endpoint defaults to `ACTIVE` too, an app holding
`students:read` doesn't get the full roster across every lifecycle state
for free, it has to explicitly pass `status=REGISTERED` (or `WITHDRAWN`,
`GRADUATED`, ...) to see anything else. `academic-history`,
`consent-status`, and `health` all work by student ID for any non-deleted
student regardless of status, no `ACTIVE` restriction on those three.

Missing or wrong token is a plain 401, no client identity leaks into the
error:

```sh
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/internal/students/lookup?nis=9990001"
# -> 401
```

A valid token missing the specific scope a route needs is a 403 naming
that scope, not a generic "forbidden":

```sh
export WRONG_SCOPE_TOKEN=$(curl -s -X POST "$BASE/api/admin/api-clients" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" \
  -d '{ "name": "Wrong Scope Client", "scope_names": ["employees:read"] }' | jq -r .data.token)

curl -s -H "Authorization: Bearer $WRONG_SCOPE_TOKEN" \
  "$BASE/api/internal/students/lookup?nis=9990001" | jq .
# -> 403 {"errors":"Forbidden: missing required scope 'students:read'"}
```

A page `size` above 100 is a plain 400, same cap the admin search endpoints
already enforce:

```sh
curl -s "$BASE/api/internal/students?size=500" \
  -H "Authorization: Bearer $STUDENT_API_TOKEN" | jq .
# -> 400 {"errors":"Too big: expected number to be <=100"}
```

Every call updates the calling `ApiClient.last_used_at`. `health` calls
specifically also write an `ACCESS_HEALTH_DATA` audit entry tagged
`api_client_id` instead of `admin_id`, even on a 404, same "always leaves
a trail" rule as the admin-side health endpoints in section 5. The other
endpoints (`lookup`, list, `academic-history`, `consent-status`) audit as
`API_ACCESS` instead, same source tagging.

### Rotating a token

`PATCH /api/admin/api-clients/rotate/:id`, Super Admin only. Generates a
new token for the same client (same id, name, scopes), invalidates the old
one immediately, and returns the new plaintext token once, same shape as
create:

```sh
export OLD_STUDENT_API_TOKEN=$STUDENT_API_TOKEN

curl -s -X PATCH "$BASE/api/admin/api-clients/rotate/$STUDENT_API_CLIENT_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | tee /tmp/rotated.json | jq .

export STUDENT_API_TOKEN=$(jq -r .data.token /tmp/rotated.json)

# the previous token is dead immediately, before this new one is even used
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $OLD_STUDENT_API_TOKEN" \
  "$BASE/api/internal/students/lookup?nis=9990001"
# -> 401
```

Rotating a revoked client is a 400 `"Cannot rotate the token of a revoked
API client"`, revoke it and issue a new one instead:

```sh
curl -s -X PATCH "$BASE/api/admin/api-clients/revoke/$STUDENT_API_CLIENT_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .
# -> "is_active": false, token stops authenticating immediately

curl -s -X PATCH "$BASE/api/admin/api-clients/rotate/$STUDENT_API_CLIENT_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_TOKEN" | jq .
# -> 400 "Cannot rotate the token of a revoked API client"
```

`GET /api/admin/api-clients` (Super Admin only) lists every client without
exposing token secrets, useful for auditing which apps currently hold a
live token and what scopes each one has.

## 13. Where the rest of the picture is

- Every rule above, plus every edge case: `bun test
src/test/student.test.ts src/test/enrollment.test.ts
src/test/parent-guardian.test.ts src/test/consent.test.ts
src/test/consent-attachment.test.ts src/test/health-record.test.ts
src/test/health-note.test.ts src/test/vaccine-record.test.ts
src/test/pc-activity.test.ts src/test/student-api.test.ts`.
- Who changed what, when: `AuditLog` rows on every create/update/delete/
  restore across all of the above, with before/after snapshots. Query via
  Prisma Studio (`bunx prisma studio`) or directly against the
  `audit_logs` table.
