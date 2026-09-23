-- CreateEnum
CREATE TYPE "IdentifierChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "identifier_change_requests" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "IdentifierChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "identifier_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identifier_change_requests_entity_type_entity_id_status_idx" ON "identifier_change_requests"("entity_type", "entity_id", "status");

-- AddForeignKey
ALTER TABLE "identifier_change_requests" ADD CONSTRAINT "identifier_change_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identifier_change_requests" ADD CONSTRAINT "identifier_change_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
