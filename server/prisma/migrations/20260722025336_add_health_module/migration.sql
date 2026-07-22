-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_HEALTH_RECORD';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_HEALTH_RECORD';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_HEALTH_RECORD';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_HEALTH_NOTE';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_HEALTH_NOTE';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_HEALTH_NOTE';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_VACCINE_RECORD';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_VACCINE_RECORD';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_VACCINE_RECORD';

-- DropIndex
DROP INDEX "vaccine_records_student_id_vaccine_type_key";

-- AlterTable
ALTER TABLE "health_notes" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "health_records" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vaccine_records" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
-- Partial unique index: only active (non soft-deleted) rows are constrained,
-- so a soft-deleted vaccine record no longer blocks re-adding the same vaccine type.
CREATE UNIQUE INDEX "vaccine_records_student_id_vaccine_type_active_key" ON "vaccine_records"("student_id", "vaccine_type") WHERE "deleted_at" IS NULL;
