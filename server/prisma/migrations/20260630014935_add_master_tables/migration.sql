/*
  Warnings:

  - You are about to drop the column `job_level` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `job_position` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `unit` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `students` table. All the data in the column will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[admin_no]` on the table `admin_users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[person_id]` on the table `employees` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[person_id]` on the table `students` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `person_id` to the `employees` table without a default value. This is not possible if the table is not empty.
  - Added the required column `person_id` to the `students` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('STUDENT', 'EMPLOYEE');

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_user_id_fkey";

-- DropForeignKey
ALTER TABLE "students" DROP CONSTRAINT "students_user_id_fkey";

-- DropIndex
DROP INDEX "employees_user_id_key";

-- DropIndex
DROP INDEX "students_user_id_key";

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "admin_no" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "job_level",
DROP COLUMN "job_position",
DROP COLUMN "unit",
DROP COLUMN "user_id",
ADD COLUMN     "job_level_id" TEXT,
ADD COLUMN     "job_position_id" TEXT,
ADD COLUMN     "person_id" TEXT NOT NULL,
ADD COLUMN     "unit_id" TEXT;

-- AlterTable
ALTER TABLE "students" DROP COLUMN "user_id",
ADD COLUMN     "person_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "users";

-- DropEnum
DROP TYPE "UserType";

-- CreateTable
CREATE TABLE "master_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_job_positions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_job_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_job_levels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_job_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "nick_name" TEXT,
    "email" TEXT,
    "person_type" "PersonType" NOT NULL,
    "gender" "Gender",
    "religion" "Religion",
    "birth_place" TEXT,
    "birth_date" TIMESTAMP(3),
    "photo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_units_name_key" ON "master_units"("name");

-- CreateIndex
CREATE UNIQUE INDEX "master_job_positions_name_key" ON "master_job_positions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "master_job_levels_name_key" ON "master_job_levels"("name");

-- CreateIndex
CREATE UNIQUE INDEX "persons_email_key" ON "persons"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_admin_no_key" ON "admin_users"("admin_no");

-- CreateIndex
CREATE UNIQUE INDEX "employees_person_id_key" ON "employees"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_person_id_key" ON "students"("person_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "master_job_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_level_id_fkey" FOREIGN KEY ("job_level_id") REFERENCES "master_job_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
