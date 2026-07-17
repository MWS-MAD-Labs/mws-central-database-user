/*
  Warnings:

  - Made the column `marital_status` on table `employees` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "marital_status" SET NOT NULL;
