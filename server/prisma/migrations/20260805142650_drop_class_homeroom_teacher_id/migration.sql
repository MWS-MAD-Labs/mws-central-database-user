-- Homeroom teacher moves fully onto class_teacher_assignments (role=HOMEROOM).
-- class_teacher_assignments already mirrors current state for every class
-- via recordHomeroomAssignmentChange, so no backfill is needed here.

DROP INDEX "classes_unique_homeroom_teacher_per_year_idx";

ALTER TABLE "classes" DROP COLUMN "homeroom_teacher_id";
