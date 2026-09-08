-- Backfills master_job_positions.unit_id for positions genuinely scoped to
-- one unit. Matched by name against real master_units rows, not hardcoded
-- IDs (cuids, not stable across environments).
--
-- Confirmed with the user 2026-09-08 for the positions whose name doesn't
-- literally contain a real unit name ("Head of IT" -> MAD Lab, "Head of
-- Operational"/"Staff Resources" -> SHIELD). "Staff Admin" is left
-- unit-agnostic (unit_id stays NULL) - unconfirmed, no unit to assign it to.
-- Everything else not listed here (Driver, Librarian, Secretary, Academic
-- Director, ...) is also left NULL on purpose: no unit name in the title
-- and no data to support restricting it.

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'CARE' AND jp."name" IN ('Head of CARE', 'Staff CARE');

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'Pelangi' AND jp."name" IN ('Head of Pelangi', 'Admin Pelangi / Secretary');

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'SAFE' AND jp."name" IN ('Head of SAFE', 'Staff SAFE');

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'COMPASS' AND jp."name" = 'Staff COMPASS';

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'Elementary' AND jp."name" = 'Principal of Elementary';

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'Junior High' AND jp."name" = 'Principal of Junior High';

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'Kindergarten' AND jp."name" = 'Principal of Kindergarten';

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'MAD Lab' AND jp."name" = 'Head of IT';

UPDATE "master_job_positions" jp
SET "unit_id" = u."id"
FROM "master_units" u
WHERE u."name" = 'SHIELD' AND jp."name" IN ('Head of Operational', 'Staff Resources');
