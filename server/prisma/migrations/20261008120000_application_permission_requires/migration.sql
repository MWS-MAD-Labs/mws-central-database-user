-- AlterTable
ALTER TABLE "application_permissions" ADD COLUMN "requires" TEXT[] DEFAULT ARRAY[]::TEXT[];
