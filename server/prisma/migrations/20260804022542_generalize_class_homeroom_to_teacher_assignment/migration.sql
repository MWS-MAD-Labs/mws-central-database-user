-- Rename (not drop+create) so existing homeroom assignment history survives.
ALTER TABLE "class_homeroom_assignments" RENAME TO "class_teacher_assignments";
ALTER TABLE "class_teacher_assignments" RENAME CONSTRAINT "class_homeroom_assignments_pkey" TO "class_teacher_assignments_pkey";
ALTER TABLE "class_teacher_assignments" RENAME CONSTRAINT "class_homeroom_assignments_class_id_fkey" TO "class_teacher_assignments_class_id_fkey";
ALTER TABLE "class_teacher_assignments" RENAME CONSTRAINT "class_homeroom_assignments_employee_id_fkey" TO "class_teacher_assignments_employee_id_fkey";

-- CreateEnum
CREATE TYPE "ClassTeacherRole" AS ENUM ('HOMEROOM', 'SUPPORTING_HOMEROOM', 'SUBJECT_TEACHER');

-- AlterTable: existing rows are all homeroom assignments by definition, so
-- the NOT NULL DEFAULT backfills them correctly.
ALTER TABLE "class_teacher_assignments" ADD COLUMN "role" "ClassTeacherRole" NOT NULL DEFAULT 'HOMEROOM';
ALTER TABLE "class_teacher_assignments" ADD COLUMN "subject" TEXT;
