-- AlterTable
ALTER TABLE "identifier_change_requests" ADD COLUMN "requester_seen_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "identifier_change_requests_requested_by_status_idx" ON "identifier_change_requests"("requested_by", "status");
