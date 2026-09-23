ALTER TABLE "student_support_assignments"
  ALTER COLUMN "employee_id" DROP NOT NULL,
  ADD COLUMN "intern_id" TEXT;

ALTER TABLE "student_support_assignments"
  ADD CONSTRAINT "student_support_assignments_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_support_assignments"
  ADD CONSTRAINT "student_support_assignments_one_workforce_member_check"
  CHECK (("employee_id" IS NOT NULL AND "intern_id" IS NULL) OR ("employee_id" IS NULL AND "intern_id" IS NOT NULL));

CREATE INDEX "student_support_assignments_intern_id_idx" ON "student_support_assignments"("intern_id");
