# Release: employee children and the newest UI, without Application Access

Branch `release/employee-children`, cut from `main`. Staging carries Application Access (Hub, role registry, group access) which has not been tested for production yet, so this branch takes only what is ready from staging.

## What is in

- Children allowance rule: a Super Admin sets the most children that count, the age limit, and which kinds of child count, under Master Data > Employment > Children Allowance. Changes are written to the audit log.
- Master Data has a new Employment tab with sub tabs (Job Positions, Job Levels, Education, Children Allowance). The old `?tab=job-positions`, `?tab=job-levels` and `?tab=education` links still open the right sub tab.
- Employee children: the table, the rules, the sensitive handling (written with employee PII access, released on reveal), the form block with birth dates or typed numbers, the detail page, and the export columns.
- The newest UI: shared components (tabs, sensitive toggle, filter toolbar, number and date fields, text and icon buttons, list popovers), the toolbar layout on every list page, Title Case labels, and the Employees, Interns, Students, Academic, Master Data, Workspace, Dashboard, Access and Change Requests pages.
- The small server parts those pages need: input limits (`constants/limits.ts` and the validations that use it), the unit filter on job levels and positions, the capacity scope filter on positions, `enrolled_academic_year_id` on the student list, and the candidate filter when assigning class teachers.

## What is not in

Everything of Application Access and the Hub: the application pages and routes, application, role, permission and group tables and migrations, API scopes sync changes, the Scopes & Categories tab in Master Data, the reworked API Clients page (it stays as in production), and the interns as people migration.

## Database

Three migrations run on production, nothing else:

1. `20261028090000_employee_children` creates the `ChildRelation` enum and the `employee_children` table.
2. `20261029090000_employee_children_counts` adds four nullable columns to `employees`.
3. `20261104090000_children_allowance_rule` creates the `children_allowance_rules` table. It starts empty, and the default rule (3 children, age 23, every kind of child) applies until a Super Admin saves one.

All three only add. Take a backup first, then `bunx prisma migrate deploy`.

## Checked before it was handed over

- `prisma migrate deploy` on a database holding exactly the production migrations applied only the three above.
- Server and client type check and lint, client production build.
- Server tests and client tests, run file by file (see the hand-over message for the numbers).

## Merging back

`staging` has the same files, so merge `main` into `staging` after this goes out. The files that were edited by hand here to leave Application Access out will conflict there: `server/prisma/schema.prisma`, `client/src/components/layout/AppShell.jsx`, `client/src/app/App.jsx`, `client/src/features/master-data/*` and `client/test/features/master-data/MasterData.test.jsx`. In every one of them keep the staging version.
