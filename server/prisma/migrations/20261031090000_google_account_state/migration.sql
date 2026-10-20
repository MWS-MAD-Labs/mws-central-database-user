-- AlterEnum
ALTER TYPE "GoogleSyncStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "GoogleSyncStatus" ADD VALUE IF NOT EXISTS 'MISSING';

-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "google_checked_at" TIMESTAMP(3),
ADD COLUMN     "google_last_login_at" TIMESTAMP(3),
ADD COLUMN     "google_password_issued_at" TIMESTAMP(3),
ADD COLUMN     "google_password_pending" BOOLEAN;
