CREATE TYPE "InternMutationField" AS ENUM ('UNIT', 'JOB_POSITION', 'BUILDING', 'STATUS');

ALTER TYPE "AuditAction" ADD VALUE 'ROLLBACK_INTERN_MUTATION';

CREATE TABLE "intern_mutation_histories" (
  "id" TEXT NOT NULL,
  "intern_id" TEXT NOT NULL,
  "field" "InternMutationField" NOT NULL,
  "unit_id" TEXT,
  "job_position_id" TEXT,
  "building_id" TEXT,
  "status" "InternStatus",
  "start_date" TIMESTAMP(3) NOT NULL,
  "end_date" TIMESTAMP(3),
  "previous_history_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "intern_mutation_histories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intern_mutation_histories_value_matches_field_check" CHECK (
    ("field" = 'UNIT' AND "unit_id" IS NOT NULL AND "job_position_id" IS NULL AND "building_id" IS NULL AND "status" IS NULL) OR
    ("field" = 'JOB_POSITION' AND "unit_id" IS NULL AND "job_position_id" IS NOT NULL AND "building_id" IS NULL AND "status" IS NULL) OR
    ("field" = 'BUILDING' AND "unit_id" IS NULL AND "job_position_id" IS NULL AND "building_id" IS NOT NULL AND "status" IS NULL) OR
    ("field" = 'STATUS' AND "unit_id" IS NULL AND "job_position_id" IS NULL AND "building_id" IS NULL AND "status" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "intern_mutation_histories_previous_history_id_key"
  ON "intern_mutation_histories"("previous_history_id")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "intern_mutation_histories_one_active_field_idx"
  ON "intern_mutation_histories"("intern_id", "field")
  WHERE "end_date" IS NULL AND "deleted_at" IS NULL;

ALTER TABLE "intern_mutation_histories" ADD CONSTRAINT "intern_mutation_histories_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intern_mutation_histories" ADD CONSTRAINT "intern_mutation_histories_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intern_mutation_histories" ADD CONSTRAINT "intern_mutation_histories_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "master_job_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intern_mutation_histories" ADD CONSTRAINT "intern_mutation_histories_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "master_buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intern_mutation_histories" ADD CONSTRAINT "intern_mutation_histories_previous_history_id_fkey" FOREIGN KEY ("previous_history_id") REFERENCES "intern_mutation_histories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
