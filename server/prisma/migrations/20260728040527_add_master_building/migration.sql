-- CreateTable
CREATE TABLE "master_buildings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_buildings_name_key" ON "master_buildings"("name");

-- AlterTable: add building_id as nullable first so we can backfill it from
-- the existing free-text `building` column before enforcing NOT NULL.
ALTER TABLE "employees" ADD COLUMN "building_id" TEXT;

-- Backfill: one master_buildings row per distinct existing building name,
-- using gen_random_uuid() to stand in for Prisma's cuid() default since this
-- is raw SQL, not a Prisma Client call.
INSERT INTO "master_buildings" ("id", "name", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "building", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "building" FROM "employees") AS distinct_buildings
ON CONFLICT ("name") DO NOTHING;

UPDATE "employees" e
SET "building_id" = mb."id"
FROM "master_buildings" mb
WHERE mb."name" = e."building";

-- AlterTable: now that every row has a building_id, drop the old column and
-- enforce NOT NULL + the foreign key.
ALTER TABLE "employees" ALTER COLUMN "building_id" SET NOT NULL;
ALTER TABLE "employees" DROP COLUMN "building";

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "master_buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
