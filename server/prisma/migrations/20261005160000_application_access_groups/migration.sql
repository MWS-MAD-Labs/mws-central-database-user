-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_ACCESS_RULE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_ACCESS_RULE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_ACCESS_RULE_DELETE';

-- Several group rules per application
DROP INDEX "application_access_rules_application_id_key";

-- AlterTable
ALTER TABLE "application_access_rules"
  ADD COLUMN "job_position_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "job_level_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "application_access_rules_application_id_idx" ON "application_access_rules"("application_id");
