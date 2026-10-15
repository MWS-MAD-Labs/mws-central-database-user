-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "address_checked_at" TIMESTAMP(3),
ADD COLUMN     "address_down_since" TIMESTAMP(3),
ADD COLUMN     "address_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "address_status" TEXT;

-- AlterTable
ALTER TABLE "api_client_credentials" ADD COLUMN     "last_rejected_at" TIMESTAMP(3);
