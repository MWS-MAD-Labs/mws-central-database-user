/*
  Warnings:

  - Made the column `unit_id` on table `admin_users` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "admin_users" DROP CONSTRAINT "admin_users_unit_id_fkey";

-- AlterTable
ALTER TABLE "admin_users" ALTER COLUMN "unit_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
