-- CreateTable
CREATE TABLE "application_organizations" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_organizations_application_id_key" ON "application_organizations"("application_id");

-- One organization per application. Keep the value already in use (the most
-- common one if they differ), otherwise generate it.
INSERT INTO "application_organizations" ("id", "application_id", "organization_id", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  apps.application_id,
  COALESCE(
    (
      SELECT used.organization_id
      FROM (
        SELECT organization_id, count(*) AS uses
        FROM (
          SELECT organization_id FROM "application_entitlements" WHERE application_id = apps.application_id
          UNION ALL
          SELECT organization_id FROM "application_access_rules" WHERE application_id = apps.application_id
        ) rows
        GROUP BY organization_id
        ORDER BY uses DESC, organization_id
        LIMIT 1
      ) used
    ),
    'org_' || replace(apps.application_id, '-', '_') || '_' || substr(md5(random()::text), 1, 6)
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT application_id FROM "application_roles"
  UNION SELECT application_id FROM "application_entitlements"
  UNION SELECT application_id FROM "application_access_rules"
) apps;

-- Rows that used another value follow the application's organization
UPDATE "application_entitlements" e
SET "organization_id" = o."organization_id"
FROM "application_organizations" o
WHERE o."application_id" = e."application_id" AND e."organization_id" <> o."organization_id";

UPDATE "application_access_rules" r
SET "organization_id" = o."organization_id"
FROM "application_organizations" o
WHERE o."application_id" = r."application_id" AND r."organization_id" <> o."organization_id";
