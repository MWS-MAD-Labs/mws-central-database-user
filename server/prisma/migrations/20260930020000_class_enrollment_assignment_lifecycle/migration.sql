-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_CLASS_TEACHER_ASSIGNMENT';

-- AlterTable
ALTER TABLE "class_teacher_assignments" ALTER COLUMN "start_date" DROP DEFAULT;
