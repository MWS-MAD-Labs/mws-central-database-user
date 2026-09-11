-- Backfills master_job_position_units from the (about to be dropped)
-- master_job_positions.unit_id single-unit column - one row per position
-- that currently has a unit set. Matched by ID, not name, since we're
-- copying from the column that's still live in this same database.
INSERT INTO "master_job_position_units" ("job_position_id", "unit_id")
SELECT "id", "unit_id" FROM "master_job_positions" WHERE "unit_id" IS NOT NULL;

-- Formalizes the hardcoded TEACHING_JOB_LEVELS/SCHOOL_UNITS rule from
-- employee-role-rules.ts into real data: "Teacher" and "SE Teacher" are
-- only valid under Kindergarten, Elementary, or Junior High. Matched by
-- name against real master_job_levels/master_units rows, not hardcoded IDs
-- (cuids, not stable across environments).
INSERT INTO "master_job_level_units" ("job_level_id", "unit_id")
SELECT jl."id", u."id"
FROM "master_job_levels" jl
CROSS JOIN "master_units" u
WHERE jl."name" IN ('Teacher', 'SE Teacher')
  AND u."name" IN ('Kindergarten', 'Elementary', 'Junior High');
