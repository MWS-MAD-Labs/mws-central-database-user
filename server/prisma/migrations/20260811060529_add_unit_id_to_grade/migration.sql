-- AlterTable
ALTER TABLE "grades" ADD COLUMN     "unit_id" TEXT;

-- One-time backfill only, mirrors deriveUnitCode() in server/src/utils/nis-generator.ts.
-- Deliberately excludes level = -9 ("Unknown (Legacy Import)"), which stays unit_id = NULL.
-- Do not reintroduce a runtime dependency between this level-range logic and Grade.unit_id
-- after this migration - unit_id becomes an independently-editable FK going forward.
UPDATE "grades" SET "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Kindergarten')
  WHERE "level" BETWEEN -3 AND 0;
UPDATE "grades" SET "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Elementary')
  WHERE "level" BETWEEN 1 AND 6;
UPDATE "grades" SET "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Junior High')
  WHERE "level" BETWEEN 7 AND 9;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
