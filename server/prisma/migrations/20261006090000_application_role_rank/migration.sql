-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPLICATION_CREATE';

-- AlterTable: 0 is the highest role of an application
ALTER TABLE "application_roles" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0;

-- Start from the role with the most permissions down to the fewest
UPDATE "application_roles" r
SET "rank" = ordered.position - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY application_id
    ORDER BY cardinality(permissions) DESC, key
  ) AS position
  FROM "application_roles"
) ordered
WHERE ordered.id = r.id;
