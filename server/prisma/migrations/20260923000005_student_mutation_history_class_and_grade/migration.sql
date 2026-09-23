-- AlterEnum
ALTER TYPE "StudentMutationField" ADD VALUE 'CURRENT_CLASS';
ALTER TYPE "StudentMutationField" ADD VALUE 'CURRENT_GRADE';

-- AlterTable
ALTER TABLE "student_mutation_histories" ADD COLUMN "class_id" TEXT;
ALTER TABLE "student_mutation_histories" ADD COLUMN "current_grade_id" TEXT;

-- AddForeignKey
ALTER TABLE "student_mutation_histories" ADD CONSTRAINT "student_mutation_histories_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_mutation_histories" ADD CONSTRAINT "student_mutation_histories_current_grade_id_fkey" FOREIGN KEY ("current_grade_id") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
