-- DropIndex
DROP INDEX "student_class_enrollments_student_id_academic_year_id_key";

-- CreateIndex
-- Partial unique index: only active (non soft-deleted) rows are constrained,
-- so a soft-deleted enrollment no longer blocks re-enrolling for the same academic year.
CREATE UNIQUE INDEX "student_class_enrollments_student_id_academic_year_id_active_key" ON "student_class_enrollments"("student_id", "academic_year_id") WHERE "deleted_at" IS NULL;
