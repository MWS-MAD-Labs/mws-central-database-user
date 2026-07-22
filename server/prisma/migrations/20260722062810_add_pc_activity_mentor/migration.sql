-- AlterEnum
ALTER TYPE "EmploymentType" ADD VALUE 'FREELANCE';

-- DropIndex
DROP INDEX "passion_connection_activities_student_id_day_academic_year__key";

-- AlterTable
ALTER TABLE "passion_connection_activities" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "mentor_id" TEXT;

-- AddForeignKey
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Partial unique index: only active (non soft-deleted) rows are constrained,
-- so a soft-deleted PC activity record no longer blocks re-adding the same day.
CREATE UNIQUE INDEX "pc_activities_student_day_year_active_key" ON "passion_connection_activities"("student_id", "day", "academic_year_id") WHERE "deleted_at" IS NULL;
