-- Half of a semester: the first half ends at half_end_date. Existing rows get the middle day.
ALTER TABLE "academic_semesters" ADD COLUMN "half_end_date" TIMESTAMP(3);
UPDATE "academic_semesters"
SET "half_end_date" = "start_date" + (FLOOR(EXTRACT(EPOCH FROM ("end_date" - "start_date")) / 86400 / 2)::int * INTERVAL '1 day');
ALTER TABLE "academic_semesters" ALTER COLUMN "half_end_date" SET NOT NULL;

-- A room remembers which semester and half its dates came from.
ALTER TABLE "pc_activity_rooms" ADD COLUMN "period_semester_id" TEXT;
ALTER TABLE "pc_activity_rooms" ADD COLUMN "period_half" INTEGER;
ALTER TABLE "pc_activity_rooms"
  ADD CONSTRAINT "pc_activity_rooms_period_semester_id_fkey"
  FOREIGN KEY ("period_semester_id") REFERENCES "academic_semesters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
