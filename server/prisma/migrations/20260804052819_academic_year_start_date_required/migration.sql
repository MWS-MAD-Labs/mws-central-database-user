/*
  Warnings:

  - Made the column `start_date` on table `academic_years` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "academic_years" ALTER COLUMN "start_date" SET NOT NULL;
