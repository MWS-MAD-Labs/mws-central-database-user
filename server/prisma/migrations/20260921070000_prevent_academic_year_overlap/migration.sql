CREATE EXTENSION IF NOT EXISTS btree_gist;

DELETE FROM "academic_years"
WHERE ("name" LIKE 'TEST\_%' ESCAPE '\' OR "name" LIKE '%Test Year%')
  AND NOT EXISTS (SELECT 1 FROM "classes" WHERE "classes"."academic_year_id" = "academic_years"."id")
  AND NOT EXISTS (SELECT 1 FROM "student_class_enrollments" WHERE "student_class_enrollments"."academic_year_id" = "academic_years"."id")
  AND NOT EXISTS (SELECT 1 FROM "students" WHERE "students"."join_academic_year_id" = "academic_years"."id")
  AND NOT EXISTS (SELECT 1 FROM "passion_connection_activities" WHERE "passion_connection_activities"."academic_year_id" = "academic_years"."id");

UPDATE "academic_years"
SET "end_date" = "start_date" + INTERVAL '1 year' - INTERVAL '1 day'
WHERE "end_date" IS NULL;

CREATE FUNCTION "academic_year_set_default_end_date"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."end_date" IS NULL THEN
    NEW."end_date" := NEW."start_date" + INTERVAL '1 year' - INTERVAL '1 day';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "academic_year_set_default_end_date_trigger"
BEFORE INSERT OR UPDATE OF "start_date", "end_date" ON "academic_years"
FOR EACH ROW
EXECUTE FUNCTION "academic_year_set_default_end_date"();

ALTER TABLE "academic_years"
  ADD CONSTRAINT "academic_years_valid_range_check"
  CHECK ("end_date" IS NOT NULL AND "start_date" < "end_date");

ALTER TABLE "academic_years"
  ADD CONSTRAINT "academic_years_no_overlap"
  EXCLUDE USING gist (
    tsrange("start_date", "end_date", '[]') WITH &&
  );
