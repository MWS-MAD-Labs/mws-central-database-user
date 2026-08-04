-- CreateEnum
CREATE TYPE "StudentSupportRole" AS ENUM ('SPECIAL_ED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ASSIGN_STUDENT_SUPPORT';
ALTER TYPE "AuditAction" ADD VALUE 'END_STUDENT_SUPPORT_ASSIGNMENT';

-- CreateTable
CREATE TABLE "student_support_assignments" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "role" "StudentSupportRole" NOT NULL DEFAULT 'SPECIAL_ED',
    "notes" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_support_assignments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "student_support_assignments" ADD CONSTRAINT "student_support_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_support_assignments" ADD CONSTRAINT "student_support_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
