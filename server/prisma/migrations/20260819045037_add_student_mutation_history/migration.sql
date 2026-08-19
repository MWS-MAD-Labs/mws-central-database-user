-- CreateEnum
CREATE TYPE "StudentMutationField" AS ENUM ('JOIN_GRADE', 'JOIN_ACADEMIC_YEAR', 'ENTRY_TYPE');

-- CreateTable
CREATE TABLE "student_mutation_histories" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "field" "StudentMutationField" NOT NULL,
    "join_grade_id" TEXT,
    "join_academic_year_id" TEXT,
    "entry_type" "StudentEntryType",
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "previous_history_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_mutation_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_mutation_histories_previous_history_id_key" ON "student_mutation_histories"("previous_history_id");

-- AddForeignKey
ALTER TABLE "student_mutation_histories" ADD CONSTRAINT "student_mutation_histories_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_mutation_histories" ADD CONSTRAINT "student_mutation_histories_join_grade_id_fkey" FOREIGN KEY ("join_grade_id") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_mutation_histories" ADD CONSTRAINT "student_mutation_histories_join_academic_year_id_fkey" FOREIGN KEY ("join_academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_mutation_histories" ADD CONSTRAINT "student_mutation_histories_previous_history_id_fkey" FOREIGN KEY ("previous_history_id") REFERENCES "student_mutation_histories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
