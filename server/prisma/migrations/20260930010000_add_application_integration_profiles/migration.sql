CREATE TYPE "IntegrationEnvironment" AS ENUM ('DEVELOPMENT', 'TEST', 'STAGING', 'PRODUCTION');
CREATE TYPE "IntegrationProfileStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DEPRECATED');
CREATE TYPE "ApiCredentialStatus" AS ENUM ('ACTIVE', 'RETIRING', 'REVOKED', 'EXPIRED');

ALTER TABLE "api_scopes"
  ADD COLUMN "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deprecated_at" TIMESTAMP(3),
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "application_integration_profiles" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "IntegrationProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_system" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_integration_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "application_integration_profiles_code_key" ON "application_integration_profiles"("code");

CREATE TABLE "application_integration_profile_scopes" (
  "profile_id" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  CONSTRAINT "application_integration_profile_scopes_pkey" PRIMARY KEY ("profile_id", "scope_id"),
  CONSTRAINT "application_integration_profile_scopes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "application_integration_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "application_integration_profile_scopes_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "api_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "api_clients"
  ADD COLUMN "status" "IntegrationProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "disabled_at" TIMESTAMP(3),
  ADD COLUMN "profile_id" TEXT,
  ADD COLUMN "environment" "IntegrationEnvironment",
  ADD COLUMN "purpose" TEXT;
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "application_integration_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "api_clients_profile_id_idx" ON "api_clients"("profile_id");
CREATE UNIQUE INDEX "api_clients_profile_environment_purpose_key" ON "api_clients"("profile_id", "environment", "purpose") WHERE "profile_id" IS NOT NULL;

CREATE TABLE "api_client_credentials" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "status" "ApiCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activates_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_client_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_client_credentials_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "api_client_credentials_token_prefix_key" ON "api_client_credentials"("token_prefix");
CREATE INDEX "api_client_credentials_client_id_status_idx" ON "api_client_credentials"("client_id", "status");

INSERT INTO "application_integration_profiles" ("id", "code", "name", "description") VALUES
  ('integration-profile-hub', 'hub', 'MWS Hub', 'MWS Hub backend integration'),
  ('integration-profile-unmapped', 'unmapped', 'Unmapped legacy integration', 'Legacy clients awaiting explicit profile assignment')
ON CONFLICT ("code") DO NOTHING;

UPDATE "api_clients"
SET "profile_id" = CASE
      WHEN "name" = 'MWS Hub' THEN (SELECT "id" FROM "application_integration_profiles" WHERE "code" = 'hub')
      ELSE (SELECT "id" FROM "application_integration_profiles" WHERE "code" = 'unmapped')
    END,
    "environment" = CASE WHEN "name" = 'MWS Hub' THEN 'DEVELOPMENT'::"IntegrationEnvironment" ELSE NULL END,
    "purpose" = CASE WHEN "name" = 'MWS Hub' THEN 'backend' ELSE 'legacy-' || "id" END;

INSERT INTO "api_client_credentials" ("id", "client_id", "token_prefix", "token_hash", "status", "issued_at", "activates_at", "last_used_at", "created_at", "updated_at")
SELECT 'legacy-credential-' || "id", "id", "token_prefix", "token_hash",
  CASE WHEN "is_active" THEN 'ACTIVE'::"ApiCredentialStatus" ELSE 'REVOKED'::"ApiCredentialStatus" END,
  "created_at", "created_at", "last_used_at", "created_at", "updated_at"
FROM "api_clients"
ON CONFLICT ("token_prefix") DO NOTHING;
