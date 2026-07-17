/*
  Warnings:

  - You are about to drop the column `health_info` on the `health_records` table. All the data in the column will be lost.
  - You are about to drop the column `special_needs` on the `health_records` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "HealthNoteCategory" AS ENUM ('HEALTH_INFO', 'SPECIAL_NEEDS');

-- CreateEnum
CREATE TYPE "HealthNoteStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- AlterTable
ALTER TABLE "health_records" DROP COLUMN "health_info",
DROP COLUMN "special_needs";

-- CreateTable
CREATE TABLE "health_notes" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "category" "HealthNoteCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "HealthNoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "noted_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_notes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "health_notes" ADD CONSTRAINT "health_notes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
