-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "organization_check_ok" BOOLEAN,
ADD COLUMN     "organization_checked_at" TIMESTAMP(3),
ADD COLUMN     "organization_reported" TEXT;
