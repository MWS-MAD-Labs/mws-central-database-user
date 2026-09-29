-- Scheduled rollover and integrity constraints for room-based PC Activity.
-- The original class-offering table was dropped by the applied room migration.
-- Its class mapping cannot be recovered reliably here, so this migration does
-- not invent pc_activity_room_classes relationships for already-migrated rooms.

ALTER TYPE "PcActivityAssignmentStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

CREATE TYPE "PcActivityMentorAssignmentStatus" AS ENUM ('ACTIVE', 'SCHEDULED', 'ENDED');

ALTER TABLE "pc_activity_room_mentor_assignments"
ADD COLUMN "status" "PcActivityMentorAssignmentStatus";

UPDATE "pc_activity_room_mentor_assignments"
SET "status" = CASE WHEN "end_date" IS NULL THEN 'ACTIVE' ELSE 'ENDED' END::"PcActivityMentorAssignmentStatus";

ALTER TABLE "pc_activity_room_mentor_assignments"
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP INDEX IF EXISTS "pc_activities_student_year_day_current_key";
CREATE UNIQUE INDEX "pc_activities_student_year_day_reserved_key"
ON "passion_connection_activities"("student_id", "academic_year_id", "day")
WHERE "deleted_at" IS NULL AND "status" IN ('ACTIVE', 'SCHEDULED');

CREATE UNIQUE INDEX "pc_activity_room_mentor_employee_reserved_key"
ON "pc_activity_room_mentor_assignments"("room_id", "employee_id")
WHERE "deleted_at" IS NULL AND "employee_id" IS NOT NULL AND "status" IN ('ACTIVE', 'SCHEDULED');

CREATE UNIQUE INDEX "pc_activity_room_mentor_intern_reserved_key"
ON "pc_activity_room_mentor_assignments"("room_id", "intern_id")
WHERE "deleted_at" IS NULL AND "intern_id" IS NOT NULL AND "status" IN ('ACTIVE', 'SCHEDULED');

ALTER TABLE "pc_activity_room_grades"
DROP CONSTRAINT IF EXISTS "pc_activity_room_grades_grade_id_fkey";
ALTER TABLE "pc_activity_room_grades"
ADD CONSTRAINT "pc_activity_room_grades_grade_id_fkey"
FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "employees" e
SET "is_pc_mentor_eligible" = true
WHERE EXISTS (
  SELECT 1 FROM "pc_activity_room_mentor_assignments" ma WHERE ma."employee_id" = e."id"
) OR EXISTS (
  SELECT 1 FROM "pc_activity_default_mentors" dm WHERE dm."mentor_id" = e."id"
);

UPDATE "interns" i
SET "is_pc_mentor_eligible" = true
WHERE EXISTS (
  SELECT 1 FROM "pc_activity_room_mentor_assignments" ma WHERE ma."intern_id" = i."id"
) OR EXISTS (
  SELECT 1 FROM "pc_activity_default_mentors" dm WHERE dm."intern_id" = i."id"
);

INSERT INTO "employee_pc_mentor_units" ("employee_id", "unit_id")
SELECT DISTINCT ma."employee_id", ru."unit_id"
FROM "pc_activity_room_mentor_assignments" ma
JOIN "pc_activity_room_units" ru ON ru."room_id" = ma."room_id"
WHERE ma."employee_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "intern_pc_mentor_units" ("intern_id", "unit_id")
SELECT DISTINCT ma."intern_id", ru."unit_id"
FROM "pc_activity_room_mentor_assignments" ma
JOIN "pc_activity_room_units" ru ON ru."room_id" = ma."room_id"
WHERE ma."intern_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "employee_pc_mentor_units" ("employee_id", "unit_id")
SELECT DISTINCT dm."mentor_id", dm."unit_id"
FROM "pc_activity_default_mentors" dm
WHERE dm."mentor_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "intern_pc_mentor_units" ("intern_id", "unit_id")
SELECT DISTINCT dm."intern_id", dm."unit_id"
FROM "pc_activity_default_mentors" dm
WHERE dm."intern_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "employee_pc_mentor_units" ("employee_id", "unit_id")
SELECT e."id", e."unit_id"
FROM "employees" e
WHERE e."is_pc_mentor_eligible" = true
  AND NOT EXISTS (SELECT 1 FROM "employee_pc_mentor_units" scope WHERE scope."employee_id" = e."id")
ON CONFLICT DO NOTHING;

INSERT INTO "intern_pc_mentor_units" ("intern_id", "unit_id")
SELECT i."id", i."unit_id"
FROM "interns" i
WHERE i."is_pc_mentor_eligible" = true
  AND NOT EXISTS (SELECT 1 FROM "intern_pc_mentor_units" scope WHERE scope."intern_id" = i."id")
ON CONFLICT DO NOTHING;
