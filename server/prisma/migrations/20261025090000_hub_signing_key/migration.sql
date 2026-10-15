-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'APPLICATION_HUB_KEY';

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "hub_signing_created_at" TIMESTAMP(3),
ADD COLUMN     "hub_signing_kid" TEXT,
ADD COLUMN     "hub_signing_thumbprint" TEXT;
