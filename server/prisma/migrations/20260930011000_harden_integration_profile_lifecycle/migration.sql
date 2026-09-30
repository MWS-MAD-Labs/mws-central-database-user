DROP INDEX IF EXISTS "api_clients_profile_environment_purpose_key";
DROP INDEX IF EXISTS "api_clients_profile_environment_purpose_active_key";

CREATE UNIQUE INDEX "api_clients_profile_environment_purpose_active_key"
ON "api_clients"("profile_id", "environment", "purpose")
WHERE "profile_id" IS NOT NULL AND "status" = 'ACTIVE';

UPDATE "api_clients" AS client
SET "environment" = NULL
FROM "application_integration_profiles" AS profile
WHERE client."profile_id" = profile."id"
  AND profile."code" = 'unmapped';
