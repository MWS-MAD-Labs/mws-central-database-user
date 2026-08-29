-- CreateEnum
CREATE TYPE "InternStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'TERMINATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_INTERN';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_INTERN';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_INTERN';

-- CreateTable
CREATE TABLE "interns" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "job_position_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "status" "InternStatus" NOT NULL DEFAULT 'ACTIVE',
    "join_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "mobile_phone" TEXT,
    "residential_address" TEXT,
    "education_level" "EducationLevel",
    "institution_name" TEXT,
    "major" TEXT,
    "graduation_year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "interns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interns_person_id_key" ON "interns"("person_id");

-- AddForeignKey
ALTER TABLE "interns" ADD CONSTRAINT "interns_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interns" ADD CONSTRAINT "interns_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interns" ADD CONSTRAINT "interns_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "master_job_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interns" ADD CONSTRAINT "interns_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "master_buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
