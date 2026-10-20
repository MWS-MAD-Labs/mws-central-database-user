-- CreateEnum
CREATE TYPE "GoogleSyncStatus" AS ENUM ('NONE', 'PENDING', 'ACTIVE', 'FAILED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GOOGLE_ACCOUNT_PROVISION';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GOOGLE_ACCOUNT_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GOOGLE_PASSWORD_RESET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UPLOAD_OWN_PHOTO';

-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "google_last_error" TEXT,
ADD COLUMN     "google_sync_status" "GoogleSyncStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "google_synced_at" TIMESTAMP(3),
ADD COLUMN     "google_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "persons_google_user_id_key" ON "persons"("google_user_id");
