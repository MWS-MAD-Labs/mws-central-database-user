-- CreateEnum
CREATE TYPE "DisciplinaryActionType" AS ENUM ('SURAT_TEGURAN', 'SURAT_PERINGATAN');

-- CreateEnum
CREATE TYPE "DisciplinaryActionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'RESOLVED', 'REVOKED', 'SUPERSEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ISSUE_DISCIPLINARY_ACTION';
ALTER TYPE "AuditAction" ADD VALUE 'RESOLVE_DISCIPLINARY_ACTION';
ALTER TYPE "AuditAction" ADD VALUE 'REVOKE_DISCIPLINARY_ACTION';
ALTER TYPE "AuditAction" ADD VALUE 'AUTO_EXPIRE_DISCIPLINARY_ACTION';

-- CreateTable
CREATE TABLE "employee_disciplinary_actions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "DisciplinaryActionType" NOT NULL,
    "level" INTEGER NOT NULL,
    "status" "DisciplinaryActionStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_date" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "document_url" TEXT,
    "issued_by_admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_disciplinary_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_disciplinary_actions_employee_id_type_status_idx" ON "employee_disciplinary_actions"("employee_id", "type", "status");

-- AddForeignKey
ALTER TABLE "employee_disciplinary_actions" ADD CONSTRAINT "employee_disciplinary_actions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_disciplinary_actions" ADD CONSTRAINT "employee_disciplinary_actions_issued_by_admin_id_fkey" FOREIGN KEY ("issued_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
