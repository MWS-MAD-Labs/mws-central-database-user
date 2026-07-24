ALTER TYPE "StudentStatus" ADD VALUE IF NOT EXISTS 'REGISTERED' BEFORE 'ACTIVE';

ALTER TABLE "students"
  ADD COLUMN "pre_delete_status" "StudentStatus";

ALTER TABLE "students"
  ALTER COLUMN "status" SET DEFAULT 'REGISTERED';
