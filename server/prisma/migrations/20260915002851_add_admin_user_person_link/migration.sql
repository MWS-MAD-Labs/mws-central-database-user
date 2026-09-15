-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "person_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_person_id_key" ON "admin_users"("person_id");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link every existing AdminUser to its Person via a case-
-- insensitive email match. Best-effort only - an AdminUser whose email
-- has since drifted from its Person (or a hand-created admin with no
-- matching Person at all) is left with person_id NULL for manual
-- reconciliation rather than blocking this migration. The unique-match
-- subquery also guards the new UNIQUE(person_id) constraint above: if a
-- case-variant email collision ever made one Person match more than one
-- AdminUser, that Person is skipped entirely (both sides left NULL)
-- instead of the migration failing outright on the constraint.
WITH candidate_matches AS (
  SELECT
    au2.id AS admin_user_id,
    p.id AS person_id,
    COUNT(*) OVER (PARTITION BY p.id) AS matches_per_person,
    COUNT(*) OVER (PARTITION BY au2.id) AS matches_per_admin
  FROM "admin_users" au2
  JOIN "persons" p ON LOWER(p.email) = LOWER(au2.email)
  WHERE au2."person_id" IS NULL
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
