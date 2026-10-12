-- CreateEnum
CREATE TYPE "HubSecretMode" AS ENUM ('SHARED', 'OWN');

-- AlterTable
ALTER TABLE "applications" ADD COLUMN "hub_secret_mode" "HubSecretMode" NOT NULL DEFAULT 'SHARED',
ADD COLUMN "hub_secret_version" INTEGER NOT NULL DEFAULT 1;
