-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'UNAUTHORIZED_ACCESS', 'CREATE_STUDENT', 'UPDATE_STUDENT', 'DEACTIVATE_STUDENT', 'DELETE_STUDENT', 'CREATE_EMPLOYEE', 'UPDATE_EMPLOYEE', 'DEACTIVATE_EMPLOYEE', 'DELETE_EMPLOYEE', 'IMPORT_DATA', 'EXPORT_DATA', 'UPLOAD_ATTACHMENT', 'DOWNLOAD_ATTACHMENT', 'ACCESS_HEALTH_DATA', 'API_ACCESS', 'API_TOKEN_CREATE', 'API_TOKEN_REVOKE', 'ROLE_CHANGE', 'PERMISSION_CHANGE');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('UI', 'API', 'SYSTEM', 'IMPORT');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('STUDENT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "admin_id" TEXT,
    "api_client_id" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "source" "AuditSource" NOT NULL DEFAULT 'UI',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT,
    "total_rows" INTEGER,
    "valid_rows" INTEGER,
    "error_rows" INTEGER,
    "result_summary" JSONB,
    "error_details" JSONB,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "total_rows" INTEGER,
    "synced_rows" INTEGER,
    "conflict_rows" INTEGER,
    "error_rows" INTEGER,
    "details" JSONB,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_api_client_id_fkey" FOREIGN KEY ("api_client_id") REFERENCES "api_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
