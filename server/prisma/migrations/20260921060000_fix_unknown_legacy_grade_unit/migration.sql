UPDATE "grades"
SET
  "level" = -9,
  "unit_id" = (SELECT "id" FROM "master_units" WHERE "name" = 'Unknown / Legacy')
WHERE "name" = 'Unknown (Legacy Import)';
