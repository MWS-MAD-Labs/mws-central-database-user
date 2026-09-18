ALTER TABLE "master_job_positions"
  ADD COLUMN "is_homeroom_position" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_subject_teacher_position" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "class_teacher_assignments"
  ALTER COLUMN "employee_id" DROP NOT NULL,
  ADD COLUMN "intern_id" TEXT;

ALTER TABLE "class_teacher_assignments"
  ADD CONSTRAINT "class_teacher_assignments_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "class_teacher_assignments"
  ADD CONSTRAINT "class_teacher_assignments_one_workforce_member_check"
  CHECK (("employee_id" IS NOT NULL AND "intern_id" IS NULL) OR ("employee_id" IS NULL AND "intern_id" IS NOT NULL));

CREATE INDEX "class_teacher_assignments_intern_id_idx" ON "class_teacher_assignments"("intern_id");
