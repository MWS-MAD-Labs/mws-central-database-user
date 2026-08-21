-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "can_write_employee_data" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_write_student_data" BOOLEAN NOT NULL DEFAULT false;
