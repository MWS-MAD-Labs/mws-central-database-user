-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_ACCESS_RULE_SET';

-- CreateEnum
CREATE TYPE "ApplicationAudience" AS ENUM ('EMPLOYEES', 'STUDENTS', 'EMPLOYEES_AND_STUDENTS');

-- CreateTable
CREATE TABLE "application_access_rules" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "audience" "ApplicationAudience" NOT NULL,
    "unit_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_role_key" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_access_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_access_rules_application_id_key" ON "application_access_rules"("application_id");
