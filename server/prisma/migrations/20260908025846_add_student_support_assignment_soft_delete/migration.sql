-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_STUDENT_SUPPORT_ASSIGNMENT';

-- AlterTable
ALTER TABLE "student_support_assignments" ADD COLUMN     "deleted_at" TIMESTAMP(3);
