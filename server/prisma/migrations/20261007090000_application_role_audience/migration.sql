-- AlterTable: which audience a role is meant for
ALTER TABLE "application_roles"
  ADD COLUMN "allows_employees" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allows_students" BOOLEAN NOT NULL DEFAULT false;

-- The roles that are for everyone: a plain participant of Daily Check-in and a Hub member
UPDATE "application_roles" SET "allows_students" = true
WHERE ("application_id" = 'daily-checkin' AND "key" = 'PARTICIPANT')
   OR ("application_id" = 'hub' AND "key" = 'MEMBER');

-- Groups that already hand a role to students keep working
UPDATE "application_roles" r SET "allows_students" = true
WHERE EXISTS (
  SELECT 1 FROM "application_access_rules" g
  WHERE g."application_id" = r."application_id"
    AND g."default_role_key" = r."key"
    AND g."is_active" = true
    AND g."audience" IN ('STUDENTS', 'EMPLOYEES_AND_STUDENTS')
);
UPDATE "application_roles" r SET "allows_employees" = false
WHERE NOT EXISTS (
  SELECT 1 FROM "application_access_rules" g
  WHERE g."application_id" = r."application_id" AND g."default_role_key" = r."key"
    AND g."audience" IN ('EMPLOYEES', 'EMPLOYEES_AND_STUDENTS')
) AND EXISTS (
  SELECT 1 FROM "application_access_rules" g
  WHERE g."application_id" = r."application_id" AND g."default_role_key" = r."key"
    AND g."audience" = 'STUDENTS'
) AND NOT EXISTS (
  SELECT 1 FROM "application_entitlements" e
  WHERE e."application_id" = r."application_id" AND e."role" = r."key"
);
