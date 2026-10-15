-- CreateEnum
CREATE TYPE "ApplicationLaunchMode" AS ENUM ('SSO', 'LINK');

-- AlterTable
ALTER TABLE "applications" ADD COLUMN "launch_mode" "ApplicationLaunchMode" NOT NULL DEFAULT 'SSO';
