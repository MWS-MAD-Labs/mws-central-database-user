-- DropIndex
DROP INDEX "consent_records_student_id_consent_type_key";

-- CreateIndex
-- Partial unique index: only active (non soft-deleted) rows are constrained,
-- so a soft-deleted consent record no longer blocks creating a new one of the same type.
CREATE UNIQUE INDEX "consent_records_student_id_consent_type_active_key" ON "consent_records"("student_id", "consent_type") WHERE "deleted_at" IS NULL;
