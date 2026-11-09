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

-- Older data may hold several active SE Teachers for one student, which the unique index below would
-- refuse. The oldest assignment stays active; the others are ended as of this migration, not deleted.
UPDATE "student_support_assignments"
SET "end_date" = now()
WHERE "role" = 'SPECIAL_ED'
  AND "end_date" IS NULL
  AND "deleted_at" IS NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("student_id") "id"
    FROM "student_support_assignments"
    WHERE "role" = 'SPECIAL_ED' AND "end_date" IS NULL AND "deleted_at" IS NULL
    ORDER BY "student_id", "start_date", "created_at", "id"
  );

-- Central is the source of truth: one active SE Teacher per Special Needs student.
CREATE UNIQUE INDEX "student_support_assignments_one_active_special_ed"
ON "student_support_assignments"("student_id", "role")
WHERE "end_date" IS NULL AND "deleted_at" IS NULL AND "role" = 'SPECIAL_ED';
