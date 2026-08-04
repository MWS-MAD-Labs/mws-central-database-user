-- AlterTable
ALTER TABLE "student_class_enrollments" ADD COLUMN     "is_retention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retention_reason" TEXT;
