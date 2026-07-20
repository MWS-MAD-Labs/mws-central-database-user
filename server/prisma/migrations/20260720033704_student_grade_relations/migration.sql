/*
  Warnings:

  - You are about to drop the column `current_grade` on the `students` table. All the data in the column will be lost.
  - You are about to drop the column `join_grade` on the `students` table. All the data in the column will be lost.
  - Added the required column `current_grade_id` to the `students` table without a default value. This is not possible if the table is not empty.
  - Added the required column `join_grade_id` to the `students` table without a default value. This is not possible if the table is not empty.
  - Made the column `join_academic_year_id` on table `students` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "students" DROP CONSTRAINT "students_join_academic_year_id_fkey";

-- AlterTable
ALTER TABLE "students" DROP COLUMN "current_grade",
DROP COLUMN "join_grade",
ADD COLUMN     "current_grade_id" TEXT NOT NULL,
ADD COLUMN     "join_grade_id" TEXT NOT NULL,
ALTER COLUMN "join_academic_year_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_current_grade_id_fkey" FOREIGN KEY ("current_grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_join_academic_year_id_fkey" FOREIGN KEY ("join_academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_join_grade_id_fkey" FOREIGN KEY ("join_grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
