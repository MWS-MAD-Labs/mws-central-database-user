-- AlterTable
ALTER TABLE "master_job_positions" ADD COLUMN     "unit_id" TEXT;

-- AddForeignKey
ALTER TABLE "master_job_positions" ADD CONSTRAINT "master_job_positions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
