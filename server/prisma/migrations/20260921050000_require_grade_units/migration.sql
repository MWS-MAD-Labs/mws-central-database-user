INSERT INTO "master_units" ("id", "name", "created_at", "updated_at") VALUES
  ('unit_kindergarten', 'Kindergarten', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('unit_elementary', 'Elementary', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('unit_junior_high', 'Junior High', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('unit_unknown_legacy', 'Unknown / Legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

UPDATE "grades"
SET "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Kindergarten')
WHERE "level" BETWEEN -3 AND 0;

UPDATE "grades"
SET "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Elementary')
WHERE "level" BETWEEN 1 AND 6;

UPDATE "grades"
SET "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Junior High')
WHERE "level" BETWEEN 7 AND 9;

UPDATE "grades"
SET "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Unknown / Legacy')
WHERE "unit_id" IS NULL;

ALTER TABLE "grades"
  DROP CONSTRAINT "grades_unit_id_fkey",
  ALTER COLUMN "unit_id" SET DEFAULT 'unit_unknown_legacy',
  ALTER COLUMN "unit_id" SET NOT NULL,
  ADD CONSTRAINT "grades_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
