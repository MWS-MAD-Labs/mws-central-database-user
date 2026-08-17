-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_CLASS_TEACHER_ASSIGNMENT';

-- AlterTable
ALTER TABLE "class_teacher_assignments" ADD COLUMN     "deleted_at" TIMESTAMP(3);
