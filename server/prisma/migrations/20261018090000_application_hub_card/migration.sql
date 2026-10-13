-- CreateEnum
CREATE TYPE "HubCardStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'COMING_SOON', 'NEW');

-- AlterTable
ALTER TABLE "applications" ADD COLUMN "hub_status" "HubCardStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "hub_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[];
