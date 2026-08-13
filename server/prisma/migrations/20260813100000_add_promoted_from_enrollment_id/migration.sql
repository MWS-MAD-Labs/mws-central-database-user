-- AlterTable
ALTER TABLE "student_class_enrollments" ADD COLUMN "promoted_from_enrollment_id" TEXT;

-- CreateIndex
CREATE INDEX "student_class_enrollments_promoted_from_enrollment_id_idx" ON "student_class_enrollments"("promoted_from_enrollment_id");

-- AddForeignKey
ALTER TABLE "student_class_enrollments" ADD CONSTRAINT "student_class_enrollments_promoted_from_enrollment_id_fkey" FOREIGN KEY ("promoted_from_enrollment_id") REFERENCES "student_class_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
