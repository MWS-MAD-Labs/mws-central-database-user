-- AlterTable
ALTER TABLE "student_class_enrollments" ADD COLUMN     "grade_id" TEXT;

-- Backfill: match by the enrollment's own grade_level name snapshot first
-- (the actual truth recorded at the time), falling back to the class's
-- current primary grade for any row whose grade_level no longer matches a
-- grade name (e.g. the grade was renamed since).
UPDATE "student_class_enrollments" sce
SET "grade_id" = g.id
FROM "grades" g
WHERE g.name = sce.grade_level
  AND sce."grade_id" IS NULL;

UPDATE "student_class_enrollments" sce
SET "grade_id" = c.grade_id
FROM "classes" c
WHERE c.id = sce.class_id
  AND sce."grade_id" IS NULL;

-- AlterTable
ALTER TABLE "student_class_enrollments" ALTER COLUMN "grade_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "student_class_enrollments" ADD CONSTRAINT "student_class_enrollments_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
