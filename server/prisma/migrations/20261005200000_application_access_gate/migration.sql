-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_ENTITLEMENT_DELETE';

-- Hub gets a floor role below ADMIN
INSERT INTO "application_roles" ("id", "application_id", "key", "label", "permissions", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'hub', 'MEMBER', 'Member', ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "application_roles" WHERE "application_id" = 'hub' AND "key" = 'MEMBER');
