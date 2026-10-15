-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_PERMISSION_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_PERMISSION_SYNC';

-- CreateEnum
CREATE TYPE "ApplicationPermissionSource" AS ENUM ('MANIFEST', 'MANUAL');

-- CreateTable
CREATE TABLE "application_permissions" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "source" "ApplicationPermissionSource" NOT NULL DEFAULT 'MANUAL',
    "deprecated_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_permissions_application_id_key_key" ON "application_permissions"("application_id", "key");

-- Everything roles already carry stays valid
INSERT INTO "application_permissions" ("id", "application_id", "key", "updated_at")
SELECT md5(random()::text || clock_timestamp()::text || "application_id" || "permission"),
       "application_id", "permission", CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "application_id", unnest("permissions") AS "permission" FROM "application_roles") used
ON CONFLICT DO NOTHING;

-- What Hub itself understands
INSERT INTO "application_permissions" ("id", "application_id", "key", "description", "updated_at")
VALUES
  (md5('hub.use' || clock_timestamp()::text), 'hub', 'hub.use', 'Sign in to Hub and open the apps given to the person', CURRENT_TIMESTAMP),
  (md5('hub.admin' || clock_timestamp()::text), 'hub', 'hub.admin', 'Open the Hub Admin Dashboard', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
