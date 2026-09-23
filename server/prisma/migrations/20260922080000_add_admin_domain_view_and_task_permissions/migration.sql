ALTER TABLE "admin_users"
ADD COLUMN "can_view_student_data" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "can_view_employee_data" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "can_manage_enrollments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "can_manage_teacher_assignments" BOOLEAN NOT NULL DEFAULT false;

UPDATE "admin_users"
SET
  "can_view_student_data" = true,
  "can_view_employee_data" = true,
  "can_manage_enrollments" = CASE
    WHEN "role" = 'DATABASE_ADMIN' THEN "can_write_student_data"
    ELSE false
  END,
  "can_manage_teacher_assignments" = CASE
    WHEN "role" = 'DATABASE_ADMIN' THEN "can_write_employee_data"
    ELSE false
  END
WHERE "role" <> 'SUPER_ADMIN';
