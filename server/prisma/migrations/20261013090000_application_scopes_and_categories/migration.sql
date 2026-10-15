-- AlterTable
ALTER TABLE "applications" ADD COLUMN "scope" TEXT;

-- CreateTable
CREATE TABLE "application_categories" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_scopes" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_categories_key_key" ON "application_categories"("key");
CREATE UNIQUE INDEX "application_categories_name_key" ON "application_categories"("name");
CREATE UNIQUE INDEX "application_scopes_key_key" ON "application_scopes"("key");
CREATE UNIQUE INDEX "application_scopes_name_key" ON "application_scopes"("name");

-- The categories the Hub always had, and the spaces. Each a millisecond apart so they keep their order.
INSERT INTO "application_categories" ("id", "key", "name", "created_at", "updated_at") VALUES
  ('cat_reporting', 'reporting', 'Reporting', CURRENT_TIMESTAMP + interval '1 millisecond', CURRENT_TIMESTAMP),
  ('cat_students', 'students', 'Students', CURRENT_TIMESTAMP + interval '2 millisecond', CURRENT_TIMESTAMP),
  ('cat_workplace', 'workplace', 'Workplace', CURRENT_TIMESTAMP + interval '3 millisecond', CURRENT_TIMESTAMP),
  ('cat_operations', 'operations', 'Operations', CURRENT_TIMESTAMP + interval '4 millisecond', CURRENT_TIMESTAMP),
  ('cat_utilities', 'utilities', 'Utilities', CURRENT_TIMESTAMP + interval '5 millisecond', CURRENT_TIMESTAMP);

INSERT INTO "application_scopes" ("id", "key", "name", "created_at", "updated_at") VALUES
  ('scope_safespace', 'safespace', 'Safespace', CURRENT_TIMESTAMP + interval '1 millisecond', CURRENT_TIMESTAMP),
  ('scope_learnspace', 'learnspace', 'Learnspace', CURRENT_TIMESTAMP + interval '2 millisecond', CURRENT_TIMESTAMP),
  ('scope_carespace', 'carespace', 'Carespace', CURRENT_TIMESTAMP + interval '3 millisecond', CURRENT_TIMESTAMP),
  ('scope_shieldspace', 'shieldspace', 'Shieldspace', CURRENT_TIMESTAMP + interval '4 millisecond', CURRENT_TIMESTAMP);
