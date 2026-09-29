-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'APPLICATION_ENTITLEMENT_GRANT';
ALTER TYPE "AuditAction" ADD VALUE 'APPLICATION_ENTITLEMENT_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'APPLICATION_ENTITLEMENT_REVOKE';

-- CreateTable
CREATE TABLE "application_entitlements" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_entitlements_person_id_application_id_key"
ON "application_entitlements"("person_id", "application_id");

-- CreateIndex
CREATE INDEX "application_entitlements_application_id_organization_id_is_active_idx"
ON "application_entitlements"("application_id", "organization_id", "is_active");

-- AddForeignKey
ALTER TABLE "application_entitlements"
ADD CONSTRAINT "application_entitlements_person_id_fkey"
FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
