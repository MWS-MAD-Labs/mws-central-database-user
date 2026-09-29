# Handoff: per-domain admin unit-view scope (item 9)

Status: COMPLETED AND VERIFIED, uncommitted, on branch `feat/admin-ux-improvements`.

Completion note (2026-09-25): all listed server services, tests, and client
Access/Profile UI were migrated to independent student/employee unit scopes.
`server/bun run typecheck` and the client production build pass. Focused admin
permission tests pass. The remaining sections below are retained as an audit
trail of the handoff state before completion.

## Second-pass verification + reusability refactor (2026-09-26)

Re-verified everything above from a cold read (did not just trust this
file's own "COMPLETED" claim):
- `grep -rn "can_view_all_units\b"` across `src/` and `schema.prisma` (prod
  code, excluding `/generated/`) returns nothing - the old field is fully
  gone.
- All 6 previously "NOT YET DONE" files (`intern-service.ts`,
  `enrollment-service.ts`, `class-service.ts`, `grade-service.ts`,
  `dashboard-service.ts`, `export-service.ts`) were confirmed already
  rewired correctly, matching the domain categorization in this doc exactly
  (verified via `resolveStudentUnitScope`/`resolveEmployeeUnitScope`/
  `resolveAcademicUnitScope` call-site grep).
- Client `AccessPage.jsx`/`accessApi.js` were already built: a single
  parameterized `UnitScopeDialog`/`UnitScopeControl`/`ScopeModeOption` set
  (domain: "student"|"employee") reused for both, no duplication - nothing
  to change there.
- `bun run typecheck` clean. Client `bunx eslint .` and `bun run build`
  clean.
- Isolated `bun test src/test/admin-permissions.test.ts
  src/test/admin-user.test.ts src/test/disciplinary-action.test.ts`:
  **136/136 pass** - the feature itself is solid.
- A full `bun test` run shows ~432 failures, but these are **not
  regressions from this feature**. Confirmed by isolating:
  - `academic_years_no_overlap` exclusion-constraint collisions across many
    files - pre-existing (see `dev_db_academic_year_test_collision` in this
    project's memory notes), because many test files each create their own
    academic-year fixture and this dev DB has a real fixed ACTIVE year from
    earlier PC-room work.
  - `grade.test.ts`'s own `afterEach` (line ~741) deletes `class` rows
    before the `student_class_enrollment` rows that reference them - a
    genuine ordering bug in that test file's cleanup, reproducible even
    running the file alone with zero other tests. Not caused by this
    session's work - pre-existing (matches `grade_test_cleanup_flakiness`
    in memory notes). Cleaned up a dangling leftover TEST_ student/grade
    from an earlier interrupted run of my own, but did not fix the
    underlying ordering bug in the test file (out of scope).
  - `export.test.ts` failures on NIK/BPJS columns for SUPER_ADMIN: the
    export endpoint now gates sensitive columns behind an explicit
    `export_mode=sensitive` query param (`includeSensitive =
    exportRequest.export_mode === "sensitive"` in `export-service.ts`) -
    confirmed via `git log`/`git diff --stat` that this param already
    existed in the last real commit (`7615eba7`), predating this session
    entirely. The test file just never got updated to pass it. Pre-existing
    test/code drift, unrelated to admin unit scope.
- **Reusability refactor** (user asked to clean up anything "numpuk"/
  repeated): found the exact intersection type `admin: AdminUser & {
  student_view_units: {...} }` (and the employee/combined variants)
  repeated 32 times inline across 13 service files. Added three named
  aliases to `server/src/utils/admin-permissions.ts` -
  `AdminUserWithStudentScope`, `AdminUserWithEmployeeScope`,
  `AdminUserWithAcademicScope` (full `AdminUser` + the relation array(s),
  as opposed to the pre-existing `AdminWithStudentViewScope`/
  `AdminWithEmployeeViewScope` which are `Pick`-based and narrower, used
  only by the resolver functions themselves) - and replaced every inline
  occurrence with the named type via `sed`/`perl -0777` plus per-file import
  edits. Zero runtime behavior change (pure type-level dedup); re-ran
  typecheck (clean) and the isolated admin-permission tests (136/136 still
  pass) afterward to confirm.

Nothing has been committed. If you pick this up next: the feature is done,
verified, and refactored - there is nothing further required for item 9
itself.

## Third pass: fixed the 3 pre-existing issues on explicit user request (2026-09-26)

User said "perbaiki itu" (fix that) after the second-pass report above, so
all 3 were fixed and verified in isolation (each `bun test src/test/<file>`
run alone, which is this project's own established verification method for
this class of issue - see `grade_test_cleanup_flakiness` in project memory:
"Red run != code regression, check this first" / use per-file isolation):

1. **`academic_years_no_overlap` collisions**: root cause was that the dev
   DB currently has **zero** `AcademicYear` rows with `status: ACTIVE`  (all
   8 real years, including the `2026/2027` one this session created earlier
   for PC-room work, had somehow ended up `COMPLETED`). `StudentTest.
   resolveAcademicYearId()` (`server/src/test/test-utils.ts`) falls back to
   creating a `TEST_STUDENT_YEAR` fixture (`2026-01-01` start) *only when no
   ACTIVE year exists* - with none active, this fallback fired on every
   single test needing a student, and its calendar-year date range collided
   with the real `2026/2027` row's date range (`2026-07-01` to
   `2027-06-30`), which still occupies that slot in the exclusion
   constraint regardless of its `status`. Fixed by setting `2026/2027` back
   to `ACTIVE`. This alone took `pc-activity-room.test.ts` from 0/29 to
   29/29 and fixed the bulk of `grade.test.ts`/`export.test.ts` failures.
   **Caveat**: a full `bun test` run still shows this same collision
   reappearing partway through, because some other (not yet identified)
   test file legitimately exercises "only one ACTIVE academic year at a
   time" business logic (`academic-year-service.ts` auto-completes the
   previously-active year when a new one is activated) and doesn't restore
   the real row afterward. Fully eliminating this would mean auditing many
   files or redesigning `resolveAcademicYearId`'s fallback to not depend on
   shared mutable global state - a separate, larger, riskier undertaking
   than what was asked here. Left as-is; flag to the user before attempting
   it.
2. **`grade.test.ts`'s own `afterEach` FK-order bug**: its `DELETE
   /api/admin/grades/:id` describe block had a redundant, wrongly-ordered
   `prismaClient.class.deleteMany(...)` call sitting *before*
   `StudentTest.delete()` - which already does the full correct cascade
   (enrollments/teacher-assignments -> TEST_-prefixed classes -> students)
   right after. Deleted the redundant line. Took this describe block from
   0/45 to 40/45 pass in isolation.
   **Remaining 5 failures in this file are a separate, pre-existing issue**:
   they depend on real seeded `Grade` rows (level 5, level 6, "Grade 1",
   etc.) that don't exist in this dev DB - this traces back to the
   intentional dev-DB reset from earlier in this session, where a full
   grade/class/employee re-seed was explicitly declared out of scope. Not
   fixed here; a full re-seed is a separate, bigger action that needs its
   own explicit go-ahead.
3. **`export.test.ts` stale `export_mode` param**: the employee/student
   export endpoints now gate sensitive columns behind an explicit
   `export_mode=sensitive` query param (this param already existed before
   this session, confirmed via `git log`/`git diff --stat` on
   `export-service.ts` - commit `7615eba7`, not something introduced by the
   admin-scope work). 8 test cases across both describe blocks expected
   sensitive columns without passing it. Added `&export_mode=sensitive` to
   each of those 8 requests. File now passes 21/21 in isolation.

Full `bun test` (all 54 files, one process): went from ~1497 pass/432 fail
to ~1507 pass/422 fail after all of the above - the modest full-suite delta
is expected given the caveat in point 1 above (shared global academic-year
state gets disturbed again by other files later in the same run). Per-file
isolated verification is what actually confirms each of the 3 fixes is
correct; the full-suite number is not the right signal for this class of
issue in this codebase.
Do NOT run `prisma migrate dev` or `prisma migrate reset` - this project only
uses `prisma migrate deploy` with hand-written migration SQL (shadow DB is
not configured). Never `--no-verify`. Only commit when the user explicitly
asks.

## What this is

User asked (in Indonesian) to replace the single `can_view_all_units` admin
flag with **two independent scopes**: `can_view_all_student_units` and
`can_view_all_employee_units`, each with its own optional custom-unit-list
(empty = admin's own unit only, non-empty = restricted to exactly those
units, "all" flag = unrestricted). This mirrors the `EmployeePcMentorUnit`/
`InternPcMentorUnit` join-table convention already in the schema.

User explicitly confirmed: split per domain is the right call (matches how
every other permission dimension - view/write/pii/sensitive - is already
independent between student and employee). For "mixed" endpoints that don't
belong to one domain (Grade, the Class entity itself, Dashboard summary,
Export roster), user chose: **union** - a unit is visible if it's covered by
EITHER the student or employee scope (undefined/unrestricted if either
domain is "all units"). This matches `canViewAcademicData`'s existing
"student OR employee" gate.

## Design already implemented

- `server/prisma/schema.prisma`: `AdminUser.can_view_all_units` replaced by
  `can_view_all_student_units` + `can_view_all_employee_units` (both
  `Boolean @default(false)`). Two new join tables:
  `AdminUserStudentViewUnit` and `AdminUserEmployeeViewUnit` (composite PK
  `admin_id`+`unit_id`, `onDelete: Cascade` both sides), with back-relations
  on `AdminUser` (`student_view_units`, `employee_view_units`) and
  `MasterUnit` (`admin_student_view_units`, `admin_employee_view_units`).
- Migration `server/prisma/migrations/20260925000004_split_admin_unit_view_scope/migration.sql`
  already written AND applied (`prisma migrate deploy` ran successfully,
  `prisma generate` ran). Backfill: existing `can_view_all_units=true` admins
  got BOTH new flags set true, preserving current behavior.
- `server/src/type/hono-context.ts`: `AdminUser` is now a **local augmented
  type** = raw Prisma `AdminUser` & `{ student_view_units: {unit_id:string}[],
  employee_view_units: {unit_id:string}[] }`. The raw Prisma type is now
  imported as `PrismaAdminUser` in that file only.
- `server/src/middleware/admin-auth-middleware.ts` and
  `dashboard-auth-middleware.ts`: both `adminUser.findFirst` calls now
  `include: { student_view_units: {select:{unit_id:true}}, employee_view_units:
  {select:{unit_id:true}} }` so every request's `c.var.admin` carries the
  scope data for free.
- `server/src/utils/admin-permissions.ts`: added
  `resolveStudentUnitScope(admin)`, `resolveEmployeeUnitScope(admin)`,
  `resolveAcademicUnitScope(admin)` (union, for mixed endpoints), plus types
  `AdminWithStudentViewScope`/`AdminWithEmployeeViewScope`. Each resolver
  returns `string[] | undefined` - **undefined means unrestricted**
  (SUPER_ADMIN or the matching all-units flag), a non-empty array is the
  allowed unit ids (custom list, or `[admin.unit_id]` if the custom list is
  empty).
- `server/src/model/admin-user-model.ts`,
  `server/src/validation/admin-user-validation.ts`: `SetCanViewAllUnitsRequest`
  split into `SetCanViewAllStudentUnitsRequest`/`SetCanViewAllEmployeeUnitsRequest`.
  `UpdateAdminPermissionsRequest`/`UPDATE_PERMISSIONS` zod schema gained
  `can_view_all_student_units`, `can_view_all_employee_units`,
  `student_view_unit_ids: string[]`, `employee_view_unit_ids: string[]`.
- `server/src/service/admin-user-service.ts`: `normalizeAdminPermissions`
  clears the relevant all-units flag + custom list when the matching domain
  (student/employee view) gets revoked, and clears the custom list when its
  own all-units flag is true (mutually exclusive). `updatePermissions` now
  destructures `student_view_unit_ids`/`employee_view_unit_ids` out of the
  Prisma `update.data` payload and syncs both join tables
  (`deleteMany`+`createMany`) inside the same transaction, and audit-logs
  old/new unit-id lists. The old single `setCanViewAllUnits` method/
  controller/route is now **two** methods/controller actions/routes:
  `setCanViewAllStudentUnits` (`PATCH /can-view-all-student-units/:id`) and
  `setCanViewAllEmployeeUnits` (`PATCH /can-view-all-employee-units/:id`).
  `AdminUserService.search`'s `findMany` now `include`s both relations (one
  query for the whole page, avoids N+1).
- `server/src/model/auth-model.ts`: `toAdminResponse` now accepts an
  optional-relations admin object; if the relations aren't pre-loaded it
  self-fetches them (so all ~15 call sites across the codebase keep working
  unchanged). `AdminResponse` gained `can_view_all_student_units`,
  `can_view_all_employee_units`, `student_view_unit_ids`,
  `employee_view_unit_ids`.

## IMPORTANT pattern to keep following for the rest

Do **NOT** blanket-swap a whole file's `import { type AdminUser } from
"../generated/prisma/client"` to import from `hono-context.ts` instead -
this was tried on `student-service.ts` and it cascaded type errors into
unrelated files (`identifier-change-request-service.ts`, `import-service.ts`)
that call e.g. `StudentService.update(admin, ...)` with a narrower admin
type. **Reverted.**

The correct, narrow-blast-radius pattern actually used (see
`student-service.ts`, `employee-service.ts`, the mutation-history services,
`student-support-assignment-service.ts`, `disciplinary-action-service.ts`,
`disciplinary-action-attachment-service.ts` for real examples): keep the
file's top-level `AdminUser` import as the plain generated-Prisma type, and
**only** widen the specific function signatures that actually call
`resolveStudentUnitScope`/`resolveEmployeeUnitScope`/`buildStudentSearchWhere`/
`buildEmployeeSearchWhere`, using an inline intersection:

```ts
admin: AdminUser & { student_view_units: { unit_id: string }[] }
// or
admin: AdminUser & { employee_view_units: { unit_id: string }[] }
```

Then replace the old check shape:

```ts
// OLD
if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_all_units && x.unit_id !== admin.unit_id) {
  throw new ResponseError(404, "... not found");
}

// NEW
const scope = resolveStudentUnitScope(admin); // or resolveEmployeeUnitScope
if (scope !== undefined && !scope.includes(x.unit_id)) {
  throw new ResponseError(404, "... not found");
}
```

For search/list where-builders that force a single `unit_id` equality
(`effectiveUnitId`), see `employee-service.ts`'s `buildEmployeeSearchWhere`
for the exact replacement pattern (requested `unit_id` still narrows further
if it's within scope, otherwise falls back to `{ in: scopeUnitIds }` instead
of erroring - preserves old UX of silently substituting).

After every file, run `bun run typecheck` (from `server/`) and check the
error list shrinks and doesn't grow in unrelated files. If a new unrelated
file shows up in the error list, that means a signature widened too broadly
- narrow it back down like the revert described above.

## Domain categorization already decided (see full grep inventory in the
## conversation this doc summarizes if you need it re-derived - it isn't saved
## elsewhere)

**STUDENT domain** (`resolveStudentUnitScope`):
- `student-service.ts` - DONE (`get`, `search`, `getBackfillCandidates`,
  `buildStudentSearchWhere`)
- `student-mutation-history-service.ts` - DONE (`getHistory`)
- `student-support-assignment-service.ts` - only `getListByIntern` needed a
  fix and it's actually EMPLOYEE domain (see below) - `getListByEmployee`
  has no unit check at all (pre-existing, not part of this refactor).
- `enrollment-service.ts` (2 occurrences, ~line 2259/2299 before this
  session's edits shifted things) - **NOT YET DONE**

**EMPLOYEE domain** (`resolveEmployeeUnitScope`):
- `employee-service.ts` - DONE (`get`, `search`, `recordPiiAccess`,
  `buildEmployeeSearchWhere`)
- `employee-mutation-history-service.ts` - DONE (`getHistory`)
- `intern-mutation-history-service.ts` - DONE (`getHistory`)
- `student-support-assignment-service.ts` - DONE (`getListByIntern`, since
  it's about the INTERN's own unit as a support-role staff member)
- `disciplinary-action-service.ts` - DONE (`assertCanReadDisciplinaryData`,
  `DisciplinaryActionService.list`)
- `disciplinary-action-attachment-service.ts` - DONE (`getList`, `download`)
- `intern-service.ts` (3 occurrences, ~line 231/237/731 before shifts) -
  **NOT YET DONE**
- `class-service.ts`'s `getTeacherAssignments` (gated by
  `assertCanViewEmployeeData`) and `getInternTeachingAssignments` - **NOT YET
  DONE**
- `export-service.ts` line ~361 (`workforceAssignmentRows` / teacher roster
  computed inside the student export flow - it's about WHO teaches, so
  employee domain even though the surrounding function is student-focused)
  - **NOT YET DONE**

**MIXED / union** (`resolveAcademicUnitScope`):
- `class-service.ts`'s `get` and `search` (gated by
  `assertCanViewAcademicData` = student OR employee) - **NOT YET DONE**
- `grade-service.ts`'s `get` and `search` (no domain gate at all currently -
  any DB_ADMIN can look up grades, just unit-scoped) - **NOT YET DONE**
- `dashboard-service.ts`'s `summary` - the single shared `unitId` variable
  needs to be split into three independent resolutions: employee scope for
  `employeePeople`/`internPeople` queries, student scope for `studentPeople`,
  union scope for `activeClasses` (since Class is a union/mixed entity) -
  **NOT YET DONE**

## Remaining work (in order)

1. Finish rewiring the "NOT YET DONE" files above (intern-service.ts,
   enrollment-service.ts, class-service.ts, grade-service.ts,
   dashboard-service.ts, export-service.ts) using the narrow intersection-type
   pattern. Run `bun run typecheck` after each file.
2. `server/src/controller/admin/admin-user-controller.ts` and
   `server/src/routes/admin/admin-user-router.ts` are already updated (split
   endpoints) - just double check nothing else references the old single
   `setCanViewAllUnits` name (grep `setCanViewAllUnits\b` without the
   Student/Employee suffix to be sure).
3. Update tests: `server/src/test/admin-permissions.test.ts`,
   `server/src/test/admin-user.test.ts`, `server/src/test/disciplinary-action.test.ts`
   all still reference the old `can_view_all_units` field directly - these
   are currently the only remaining typecheck errors outside production code
   (confirm with `bun run typecheck` - as of this handoff, exactly these 3
   test files plus the 6 "NOT YET DONE" service files above are red).
4. Client side (`client/src/features/access/api/accessApi.js`,
   `client/src/features/access/pages/AccessPage.jsx`) - **NOT STARTED AT
   ALL**. Needs: rename/split `setCanViewAllUnits` API call into two, update
   `updatePermissions` payload builder to include the 4 new fields, and
   build UI for editing the two custom-unit-lists (likely a multi-select
   attached to each of the Student/Employee `PermissionGroupMenu` groups -
   see the "Scope" group added earlier this session for the old single
   toggle's nesting-under-view-flags treatment, which should carry over
   conceptually to both new toggles).
5. Full `bun run typecheck`, `bun run build`/`bunx eslint .` on client, and
   run the full server test suite (`bun test`) at the end - not just the
   PC-room-scoped subset used earlier in this session.
6. Nothing has been committed. Do not commit without the user's explicit
   ask, per this project's CLAUDE.md.

## Quick resume commands

```bash
cd /home/mws-web-dev/Developments/MWS/mws-data-center/server
bun run typecheck 2>&1 | grep "^Errors\|^     [0-9]"   # current red-file list
```
