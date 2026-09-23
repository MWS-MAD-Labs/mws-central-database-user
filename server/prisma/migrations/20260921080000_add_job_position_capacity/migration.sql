CREATE TYPE "PositionCapacityScope" AS ENUM ('PER_UNIT', 'GLOBAL');

ALTER TABLE "master_job_positions"
  ADD COLUMN "capacity_scope" "PositionCapacityScope",
  ADD COLUMN "max_active_holders" INTEGER;

ALTER TABLE "master_job_positions"
  ADD CONSTRAINT "master_job_positions_capacity_pair_check"
  CHECK (
    ("capacity_scope" IS NULL AND "max_active_holders" IS NULL) OR
    ("capacity_scope" IS NOT NULL AND "max_active_holders" IS NOT NULL AND "max_active_holders" > 0)
  );
