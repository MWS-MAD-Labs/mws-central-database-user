-- AddColumn
ALTER TABLE "admin_users" ADD COLUMN "can_view_all_student_units" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "admin_users" ADD COLUMN "can_view_all_employee_units" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve existing behavior for admins who already had the
-- combined flag - both new flags start equal to the old one, per-domain
-- customization is opt-in from here.
UPDATE "admin_users" SET "can_view_all_student_units" = "can_view_all_units", "can_view_all_employee_units" = "can_view_all_units";

-- DropColumn
ALTER TABLE "admin_users" DROP COLUMN "can_view_all_units";

-- CreateTable
CREATE TABLE "admin_user_student_view_units" (
    "admin_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "admin_user_student_view_units_pkey" PRIMARY KEY ("admin_id","unit_id")
);

-- CreateTable
CREATE TABLE "admin_user_employee_view_units" (
    "admin_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "admin_user_employee_view_units_pkey" PRIMARY KEY ("admin_id","unit_id")
);

-- AddForeignKey
ALTER TABLE "admin_user_student_view_units" ADD CONSTRAINT "admin_user_student_view_units_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_user_student_view_units" ADD CONSTRAINT "admin_user_student_view_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_employee_view_units" ADD CONSTRAINT "admin_user_employee_view_units_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_user_employee_view_units" ADD CONSTRAINT "admin_user_employee_view_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
