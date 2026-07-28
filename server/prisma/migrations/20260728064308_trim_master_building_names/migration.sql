-- Defensive cleanup for the backfill in migration 20260728040527
-- (add_master_building): that migration copied the legacy free-text
-- `building` column verbatim, so a stray leading/trailing whitespace
-- variant (e.g. "Elementary " vs "Elementary") in old data would have
-- produced two separate MasterBuilding rows instead of one. This merges
-- any such duplicates - reassigning employees to the canonical
-- (already-trimmed) row before deleting the duplicate - and trims any
-- remaining untrimmed name that has no existing canonical counterpart.
DO $$
DECLARE
  dup RECORD;
  canonical_id TEXT;
BEGIN
  FOR dup IN
    SELECT id, name FROM master_buildings WHERE name != TRIM(name)
  LOOP
    SELECT id INTO canonical_id
    FROM master_buildings
    WHERE name = TRIM(dup.name) AND id != dup.id;

    IF canonical_id IS NOT NULL THEN
      UPDATE employees SET building_id = canonical_id WHERE building_id = dup.id;
      DELETE FROM master_buildings WHERE id = dup.id;
    ELSE
      UPDATE master_buildings SET name = TRIM(name) WHERE id = dup.id;
    END IF;
  END LOOP;
END $$;
