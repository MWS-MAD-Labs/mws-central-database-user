-- The real business rule is one active PC activity per student per
-- academic year, not one per (student, day, academic year) - a student
-- picks a single activity for the whole year; the day is just which
-- weekday that activity meets. Clean up any existing rows that violate
-- the new rule before enforcing it (keep the earliest-created active row
-- per student/year, soft-delete the rest).
UPDATE "passion_connection_activities" AS p
SET "deleted_at" = CURRENT_TIMESTAMP
WHERE "deleted_at" IS NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("student_id", "academic_year_id") "id"
    FROM "passion_connection_activities"
    WHERE "deleted_at" IS NULL
    ORDER BY "student_id", "academic_year_id", "created_at" ASC
  );

-- DropIndex
DROP INDEX "pc_activities_student_day_year_active_key";

-- CreateIndex (partial - one active PC activity per student per academic year)
CREATE UNIQUE INDEX "pc_activities_student_year_active_key" ON "passion_connection_activities"("student_id", "academic_year_id") WHERE "deleted_at" IS NULL;
