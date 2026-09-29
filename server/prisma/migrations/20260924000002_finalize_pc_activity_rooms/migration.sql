-- Finalize room-based PC Activities after the initial room migration.

ALTER TYPE "PcActivityAssignmentStatus" ADD VALUE IF NOT EXISTS 'ENDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'END_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REASSIGN_PC_ACTIVITY_ROOM_STUDENT';

ALTER TABLE "employees"
ADD COLUMN IF NOT EXISTS "is_pc_mentor_eligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "interns"
ADD COLUMN IF NOT EXISTS "is_pc_mentor_eligible" BOOLEAN NOT NULL DEFAULT false;

UPDATE "employees" e
SET "is_pc_mentor_eligible" = jl."is_pc_mentor_eligible"
FROM "master_job_levels" jl
WHERE e."job_level_id" = jl."id";

UPDATE "interns" i
SET "is_pc_mentor_eligible" = jp."is_pc_mentor_eligible"
FROM "master_job_positions" jp
WHERE i."job_position_id" = jp."id";

ALTER TABLE "pc_activity_rooms" RENAME COLUMN "name" TO "label";
ALTER TABLE "pc_activity_rooms" ADD COLUMN "start_date" TIMESTAMP(3);
ALTER TABLE "pc_activity_rooms" ADD COLUMN "end_date" TIMESTAMP(3);

UPDATE "pc_activity_rooms" r
SET
  "start_date" = ay."start_date",
  "end_date" = COALESCE(ay."end_date", ay."start_date" + INTERVAL '1 year')
FROM "academic_years" ay
WHERE r."academic_year_id" = ay."id";

ALTER TABLE "pc_activity_rooms" ALTER COLUMN "start_date" SET NOT NULL;
ALTER TABLE "pc_activity_rooms" ALTER COLUMN "end_date" SET NOT NULL;

ALTER TABLE "passion_connection_activities" ADD COLUMN "end_date" TIMESTAMP(3);

UPDATE "passion_connection_activities" pca
SET "expires_at" = r."end_date"
FROM "pc_activity_rooms" r
WHERE pca."room_id" = r."id" AND pca."status" = 'ACTIVE';

DROP INDEX IF EXISTS "pc_activities_student_year_current_key";
CREATE UNIQUE INDEX "pc_activities_student_year_day_current_key"
ON "passion_connection_activities"("student_id", "academic_year_id", "day")
WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "pc_activity_rooms_academic_year_id_idx"
ON "pc_activity_rooms"("academic_year_id");
CREATE INDEX IF NOT EXISTS "pc_activity_rooms_activity_id_idx"
ON "pc_activity_rooms"("activity_id");
CREATE INDEX IF NOT EXISTS "pc_activity_room_mentor_assignments_room_id_idx"
ON "pc_activity_room_mentor_assignments"("room_id");
CREATE INDEX IF NOT EXISTS "passion_connection_activities_room_id_idx"
ON "passion_connection_activities"("room_id");
