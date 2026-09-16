-- CreateEnum
CREATE TYPE "BloodType" AS ENUM ('A', 'B', 'AB', 'O', 'UNKNOWN');

-- Normalize any existing free-text values before casting the column type.
-- Unmappable legacy junk goes to NULL, not UNKNOWN - NULL means "not
-- recorded", UNKNOWN means "checked, blood type isn't known".
UPDATE "health_records"
SET "blood_type" = CASE UPPER(TRIM(BOTH FROM "blood_type"))
  WHEN 'A' THEN 'A'
  WHEN 'A+' THEN 'A'
  WHEN 'A-' THEN 'A'
  WHEN 'B' THEN 'B'
  WHEN 'B+' THEN 'B'
  WHEN 'B-' THEN 'B'
  WHEN 'AB' THEN 'AB'
  WHEN 'AB+' THEN 'AB'
  WHEN 'AB-' THEN 'AB'
  WHEN 'O' THEN 'O'
  WHEN 'O+' THEN 'O'
  WHEN 'O-' THEN 'O'
  WHEN 'UNKNOWN' THEN 'UNKNOWN'
  ELSE NULL
END
WHERE "blood_type" IS NOT NULL;

-- AlterTable
ALTER TABLE "health_records" ALTER COLUMN "blood_type" TYPE "BloodType" USING ("blood_type"::"BloodType");
