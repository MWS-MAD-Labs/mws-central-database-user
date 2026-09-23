ALTER TABLE "student_support_assignments"
  DROP CONSTRAINT "student_support_assignments_intern_id_fkey",
  ADD CONSTRAINT "student_support_assignments_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pc_activity_default_mentors"
  DROP CONSTRAINT "pc_activity_default_mentors_intern_id_fkey",
  ADD CONSTRAINT "pc_activity_default_mentors_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "class_teacher_assignments"
  DROP CONSTRAINT "class_teacher_assignments_intern_id_fkey",
  ADD CONSTRAINT "class_teacher_assignments_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
