-- CreateTable
CREATE TABLE "master_job_position_units" (
    "job_position_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "master_job_position_units_pkey" PRIMARY KEY ("job_position_id","unit_id")
);

-- CreateTable
CREATE TABLE "master_job_level_units" (
    "job_level_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "master_job_level_units_pkey" PRIMARY KEY ("job_level_id","unit_id")
);

-- AddForeignKey
ALTER TABLE "master_job_position_units" ADD CONSTRAINT "master_job_position_units_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "master_job_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_job_position_units" ADD CONSTRAINT "master_job_position_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_job_level_units" ADD CONSTRAINT "master_job_level_units_job_level_id_fkey" FOREIGN KEY ("job_level_id") REFERENCES "master_job_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_job_level_units" ADD CONSTRAINT "master_job_level_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
