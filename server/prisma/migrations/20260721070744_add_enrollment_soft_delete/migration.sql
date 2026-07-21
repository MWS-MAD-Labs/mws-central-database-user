-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DELETE_ENROLLMENT';
ALTER TYPE "AuditAction" ADD VALUE 'RESTORE_ENROLLMENT';

-- AlterTable
ALTER TABLE "student_class_enrollments" ADD COLUMN     "deleted_at" TIMESTAMP(3);
