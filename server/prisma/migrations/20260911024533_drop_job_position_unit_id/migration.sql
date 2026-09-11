-- DropForeignKey
ALTER TABLE "master_job_positions" DROP CONSTRAINT "master_job_positions_unit_id_fkey";

-- AlterTable
ALTER TABLE "master_job_positions" DROP COLUMN "unit_id";
