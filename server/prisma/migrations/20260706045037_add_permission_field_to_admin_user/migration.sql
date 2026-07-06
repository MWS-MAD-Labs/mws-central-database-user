/*
  Warnings:

  - You are about to drop the column `unit_scope` on the `admin_users` table. All the data in the column will be lost.
  - Made the column `employment_type` on table `employees` required. This step will fail if there are existing NULL values in that column.
  - Made the column `building` on table `employees` required. This step will fail if there are existing NULL values in that column.
  - Made the column `join_date` on table `employees` required. This step will fail if there are existing NULL values in that column.
  - Made the column `job_level_id` on table `employees` required. This step will fail if there are existing NULL values in that column.
  - Made the column `job_position_id` on table `employees` required. This step will fail if there are existing NULL values in that column.
  - Made the column `unit_id` on table `employees` required. This step will fail if there are existing NULL values in that column.
  - Made the column `nick_name` on table `persons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `email` on table `persons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `gender` on table `persons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `religion` on table `persons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `birth_place` on table `persons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `birth_date` on table `persons` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_job_level_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_job_position_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_unit_id_fkey";

-- AlterTable
ALTER TABLE "admin_users" DROP COLUMN "unit_scope",
ADD COLUMN     "can_create_data" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unit_id" TEXT;

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "employment_type" SET NOT NULL,
ALTER COLUMN "building" SET NOT NULL,
ALTER COLUMN "join_date" SET NOT NULL,
ALTER COLUMN "job_level_id" SET NOT NULL,
ALTER COLUMN "job_position_id" SET NOT NULL,
ALTER COLUMN "unit_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "persons" ALTER COLUMN "nick_name" SET NOT NULL,
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "gender" SET NOT NULL,
ALTER COLUMN "religion" SET NOT NULL,
ALTER COLUMN "birth_place" SET NOT NULL,
ALTER COLUMN "birth_date" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "master_job_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_level_id_fkey" FOREIGN KEY ("job_level_id") REFERENCES "master_job_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
