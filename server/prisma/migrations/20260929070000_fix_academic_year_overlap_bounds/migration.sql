-- The original academic_years_no_overlap constraint used an inclusive-
-- inclusive range ('[]'), which flags two back-to-back academic years
-- (one ending exactly when the next starts, e.g. legacy-imported years
-- like 2018-01-01..2019-01-01 followed by 2019-01-01..2020-01-01) as
-- overlapping even though they don't share any real time. Recreate it as
-- half-open ('[)') so the end instant belongs only to the next year.
ALTER TABLE "academic_years"
  DROP CONSTRAINT IF EXISTS "academic_years_no_overlap";

ALTER TABLE "academic_years"
  ADD CONSTRAINT "academic_years_no_overlap"
  EXCLUDE USING gist (
    tsrange("start_date", "end_date", '[)') WITH &&
  );
