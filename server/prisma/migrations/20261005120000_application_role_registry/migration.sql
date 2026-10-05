-- CreateEnum values
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_ROLE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_ROLE_UPDATE';

-- CreateTable
CREATE TABLE "application_roles" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_roles_application_id_key_key" ON "application_roles"("application_id", "key");

-- Seed the roles that were hardcoded in the entitlement validation, plus the Hub admin role
INSERT INTO "application_roles" ("id", "application_id", "key", "label", "permissions", "is_active", "created_at", "updated_at") VALUES
  (gen_random_uuid()::text, 'exima', 'ADMIN', 'Admin', ARRAY['app.admin','dashboard.read','analytics.read','users.manage','credentials.read','credentials.manage','accurate.manage','inventory.export','inventory.import','borrowing.manage','pos.catalog.read','pos.manage','pos.checkout','pos.sales.read','pos.sales.void','allowance.manage','allowance.collect','store.use']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'exima', 'RESOURCE', 'Resource', ARRAY['credentials.read','inventory.export','inventory.import','borrowing.manage']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'exima', 'CASHIER', 'Cashier', ARRAY['credentials.read','pos.catalog.read','pos.checkout','pos.sales.read','allowance.collect']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'exima', 'STAFF', 'Staff', ARRAY['credentials.read','pos.catalog.read','store.use']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'daily-checkin', 'PARTICIPANT', 'Participant', ARRAY['checkin.self.read','checkin.self.submit','support.contacts.read','notifications.self.manage','assistant.use']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'daily-checkin', 'EDUCATOR', 'Educator', ARRAY['checkin.self.read','checkin.self.submit','support.contacts.read','notifications.self.manage','assistant.use','student_checkins.read']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'daily-checkin', 'SUPPORT', 'Support', ARRAY['checkin.self.read','checkin.self.submit','support.contacts.read','notifications.self.manage','assistant.use','student_checkins.read','dashboard.read','support_requests.manage']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'daily-checkin', 'ADMIN', 'Admin', ARRAY['checkin.self.read','checkin.self.submit','support.contacts.read','notifications.self.manage','assistant.use','student_checkins.read','dashboard.read','support_requests.manage','users.read','users.manage','organizations.manage','notifications.create','sync.read','sync.run','dev_topology.read']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'daily-checkin', 'SUPERADMIN', 'Super Admin', ARRAY['checkin.self.read','checkin.self.submit','support.contacts.read','notifications.self.manage','assistant.use','student_checkins.read','dashboard.read','support_requests.manage','users.read','users.manage','organizations.manage','notifications.create','sync.read','sync.run','dev_topology.read','users.deactivate','dashboard.export']::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hub', 'ADMIN', 'Admin', ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Role keys are uppercase from now on
UPDATE "application_entitlements" SET "role" = upper("role") WHERE "application_id" IN ('exima', 'daily-checkin', 'hub');
