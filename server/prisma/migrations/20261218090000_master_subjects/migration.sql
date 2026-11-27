-- Subjects are rows, so a class teacher assignment points at a subject and renaming one renames it everywhere.
CREATE TABLE "master_subjects" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_subjects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_subjects_key_key" ON "master_subjects"("key");
CREATE UNIQUE INDEX "master_subjects_name_key" ON "master_subjects"("name");

ALTER TABLE "class_teacher_assignments" ADD COLUMN "subject_id" TEXT;
CREATE INDEX "class_teacher_assignments_subject_id_idx" ON "class_teacher_assignments"("subject_id");
ALTER TABLE "class_teacher_assignments" ADD CONSTRAINT "class_teacher_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "master_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One subject for each distinct text already written on an assignment: the same text written with other spacing or letter case is one subject, named as it was first written.
INSERT INTO "master_subjects" ("id", "key", "name", "created_at", "updated_at")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || chosen.key), 1, 24), chosen.key, chosen.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (key) key, name
  FROM (
    SELECT btrim(regexp_replace(lower(btrim(regexp_replace("subject", '\s+', ' ', 'g'))), '[^a-z0-9]+', '-', 'g'), '-') AS key,
           btrim(regexp_replace("subject", '\s+', ' ', 'g')) AS name,
           "created_at"
    FROM "class_teacher_assignments"
    WHERE "subject" IS NOT NULL AND btrim("subject") <> ''
  ) written
  WHERE key <> ''
  ORDER BY key, created_at
) chosen;

UPDATE "class_teacher_assignments" a
SET "subject_id" = m."id"
FROM "master_subjects" m
WHERE a."subject" IS NOT NULL AND m."key" = btrim(regexp_replace(lower(btrim(regexp_replace(a."subject", '\s+', ' ', 'g'))), '[^a-z0-9]+', '-', 'g'), '-');
