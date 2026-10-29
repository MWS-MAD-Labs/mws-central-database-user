-- A revoked API client can be deleted. The audit rows keep who it was: its name and token prefix are copied onto
-- each row, so the actor still reads after the client row is gone.
ALTER TABLE "audit_logs" ADD COLUMN "api_client_label" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "api_client_prefix" TEXT;

UPDATE "audit_logs" AS a
SET "api_client_label" = c."name", "api_client_prefix" = c."token_prefix"
FROM "api_clients" AS c
WHERE a."api_client_id" = c."id";

ALTER TYPE "AuditAction" ADD VALUE 'API_TOKEN_DELETE';
