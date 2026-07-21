-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_ENROLLMENT';
ALTER TYPE "AuditAction" ADD VALUE 'PROMOTE_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_STUDENT_CLASS';
ALTER TYPE "AuditAction" ADD VALUE 'WITHDRAW_STUDENT_ENROLLMENT';
