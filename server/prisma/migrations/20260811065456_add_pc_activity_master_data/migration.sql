-- CreateTable
CREATE TABLE "master_pc_activities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_pc_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_pc_activities_name_key" ON "master_pc_activities"("name");

-- Data-preserving backfill: turn every distinct existing free-text
-- "activity" value into its own master-data row, keyed by that same text.
INSERT INTO "master_pc_activities" ("id", "name", "updated_at")
SELECT gen_random_uuid()::text, distinct_activity."activity", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "activity" FROM "passion_connection_activities"
) AS distinct_activity;

-- AlterTable: add nullable first, backfill, then tighten to NOT NULL -
-- avoids the "required column without a default" failure on a non-empty
-- table that the raw prisma-generated migration would have hit.
ALTER TABLE "passion_connection_activities" ADD COLUMN "activity_id" TEXT;

UPDATE "passion_connection_activities" pca
SET "activity_id" = mpa."id"
FROM "master_pc_activities" mpa
WHERE mpa."name" = pca."activity";

ALTER TABLE "passion_connection_activities" ALTER COLUMN "activity_id" SET NOT NULL;

ALTER TABLE "passion_connection_activities" DROP COLUMN "activity";

-- AddForeignKey
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "master_pc_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
