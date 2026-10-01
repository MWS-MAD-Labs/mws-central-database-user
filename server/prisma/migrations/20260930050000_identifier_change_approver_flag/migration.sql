-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN "can_approve_identifier_changes" BOOLEAN NOT NULL DEFAULT false;

-- Re-run the person link backfill for admins created after the first one,
-- same unique-match guard as 20260915002851_add_admin_user_person_link.
WITH candidate_matches AS (
  SELECT
    au2.id AS admin_user_id,
    p.id AS person_id,
    COUNT(*) OVER (PARTITION BY p.id) AS matches_per_person,
    COUNT(*) OVER (PARTITION BY au2.id) AS matches_per_admin
  FROM "admin_users" au2
  JOIN "persons" p ON LOWER(p.email) = LOWER(au2.email)
  WHERE au2."person_id" IS NULL
    AND p."person_type" = 'EMPLOYEE'
    AND p."deleted_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "admin_users" x WHERE x."person_id" = p.id)
),
unique_matches AS (
  SELECT admin_user_id, person_id
  FROM candidate_matches
  WHERE matches_per_person = 1 AND matches_per_admin = 1
)
UPDATE "admin_users" AS au
SET "person_id" = unique_matches.person_id
FROM unique_matches
WHERE au.id = unique_matches.admin_user_id;
