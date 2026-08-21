-- Backfill: anyone who could write under the old single flag keeps writing
-- under both new domain flags, so no admin silently loses access when this
-- migration lands.
UPDATE "admin_users"
SET "can_write_employee_data" = TRUE,
    "can_write_student_data" = TRUE
WHERE "can_write_data" = TRUE;

-- AlterTable
ALTER TABLE "admin_users" DROP COLUMN "can_write_data";
