-- Existing active assignments already represent approved Special Education support.
UPDATE "students" s
SET "sn" = true
WHERE EXISTS (
  SELECT 1
  FROM "student_support_assignments" a
  WHERE a."student_id" = s."id"
    AND a."role" = 'SPECIAL_ED'
    AND a."end_date" IS NULL
    AND a."deleted_at" IS NULL
);

-- Central is the source of truth: one active SE Teacher per Special Needs student.
CREATE UNIQUE INDEX "student_support_assignments_one_active_special_ed"
ON "student_support_assignments"("student_id", "role")
WHERE "end_date" IS NULL AND "deleted_at" IS NULL AND "role" = 'SPECIAL_ED';
