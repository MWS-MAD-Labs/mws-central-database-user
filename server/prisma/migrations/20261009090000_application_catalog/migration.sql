-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT,
    "launch_url" TEXT,
    "logout_url" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_application_id_key" ON "applications"("application_id");

-- Existing applications get a row named after their id, not published.
INSERT INTO "applications" ("id", "application_id", "name", "updated_at")
SELECT 'app_' || md5(ids."application_id"), ids."application_id", ids."application_id", CURRENT_TIMESTAMP
FROM (
  SELECT "application_id" FROM "application_organizations"
  UNION SELECT "application_id" FROM "application_roles"
  UNION SELECT "application_id" FROM "application_access_rules"
  UNION SELECT "application_id" FROM "application_entitlements"
) AS ids;
