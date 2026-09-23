ALTER TABLE "pc_activity_default_mentors"
  ALTER COLUMN "mentor_id" DROP NOT NULL,
  ADD COLUMN "intern_id" TEXT;

ALTER TABLE "pc_activity_default_mentors"
  ADD CONSTRAINT "pc_activity_default_mentors_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pc_activity_default_mentors"
  ADD CONSTRAINT "pc_activity_default_mentors_one_workforce_member_check"
  CHECK (("mentor_id" IS NOT NULL AND "intern_id" IS NULL) OR ("mentor_id" IS NULL AND "intern_id" IS NOT NULL));

CREATE INDEX "pc_activity_default_mentors_intern_id_idx" ON "pc_activity_default_mentors"("intern_id");

ALTER TABLE "pc_activity_mentor_mutation_histories"
  ADD COLUMN "intern_id" TEXT;

ALTER TABLE "pc_activity_mentor_mutation_histories"
  ADD CONSTRAINT "pc_activity_mentor_mutation_histories_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pc_activity_mentor_mutation_histories"
  ADD CONSTRAINT "pc_activity_mentor_history_at_most_one_workforce_member_check"
  CHECK (NOT ("mentor_id" IS NOT NULL AND "intern_id" IS NOT NULL));

CREATE INDEX "pc_activity_mentor_mutation_histories_intern_id_idx" ON "pc_activity_mentor_mutation_histories"("intern_id");
