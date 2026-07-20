/*
  Warnings:

  - You are about to drop the column `join_academic_year` on the `students` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "students" DROP COLUMN "join_academic_year",
ADD COLUMN     "join_academic_year_id" TEXT;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_join_academic_year_id_fkey" FOREIGN KEY ("join_academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;
