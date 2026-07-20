/*
  Warnings:

  - You are about to drop the column `assigned_class` on the `employees` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "employees" DROP COLUMN "assigned_class";

-- CreateTable
CREATE TABLE "class_homeroom_assignments" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_homeroom_assignments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "class_homeroom_assignments" ADD CONSTRAINT "class_homeroom_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_homeroom_assignments" ADD CONSTRAINT "class_homeroom_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce at the database level that one employee can be homeroom teacher
-- of at most one class per academic year. The application layer already
-- checks this in class-service.ts, but that check-then-write is not atomic
-- under concurrent requests; this partial unique index is the safety net
-- that makes the invariant hold even under a race (same precedent as
-- academic_years_single_active_idx for the single-active-academic-year rule).
CREATE UNIQUE INDEX "classes_unique_homeroom_teacher_per_year_idx"
ON "classes" ("academic_year_id", "homeroom_teacher_id")
WHERE "homeroom_teacher_id" IS NOT NULL;
