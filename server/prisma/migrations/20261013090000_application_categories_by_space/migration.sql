-- Categories are now the spaces. The old buckets all go to others until each application is placed.
UPDATE "applications"
SET "category" = 'others'
WHERE "category" IS NOT NULL
  AND "category" NOT IN ('safespace', 'learnspace', 'carespace', 'shieldspace', 'others');
