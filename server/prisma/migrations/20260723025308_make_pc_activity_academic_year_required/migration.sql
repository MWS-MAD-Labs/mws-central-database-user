/*
  Warnings:

  - Made the column `academic_year_id` on table `passion_connection_activities` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "passion_connection_activities" DROP CONSTRAINT "passion_connection_activities_academic_year_id_fkey";

-- Backfill any pre-existing NULL academic_year_id to the current active
-- academic year before enforcing NOT NULL. If there is no active academic
-- year and NULL rows exist, this leaves them NULL and the next statement
-- fails loudly instead of guessing a year.
UPDATE "passion_connection_activities"
SET "academic_year_id" = (SELECT "id" FROM "academic_years" WHERE "status" = 'ACTIVE' LIMIT 1)
WHERE "academic_year_id" IS NULL;

-- AlterTable
ALTER TABLE "passion_connection_activities" ALTER COLUMN "academic_year_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
