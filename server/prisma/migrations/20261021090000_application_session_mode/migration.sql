-- CreateEnum
CREATE TYPE "ApplicationSessionMode" AS ENUM ('RELAY', 'SHARED');

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "session_mode" "ApplicationSessionMode" NOT NULL DEFAULT 'RELAY';
