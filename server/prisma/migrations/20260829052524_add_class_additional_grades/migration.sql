-- CreateTable
CREATE TABLE "class_additional_grades" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "grade_id" TEXT NOT NULL,

    CONSTRAINT "class_additional_grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_additional_grades_class_id_grade_id_key" ON "class_additional_grades"("class_id", "grade_id");

-- AddForeignKey
ALTER TABLE "class_additional_grades" ADD CONSTRAINT "class_additional_grades_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_additional_grades" ADD CONSTRAINT "class_additional_grades_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
