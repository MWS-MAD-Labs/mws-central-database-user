-- CreateEnum
CREATE TYPE "VaccineType" AS ENUM ('POLIO', 'DPT', 'MEASLES', 'HEPATITIS_B', 'BCG', 'MMR', 'COVID_1', 'COVID_2');

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'DOCUMENTATION_CONSENT';

-- AlterTable
ALTER TABLE "health_records" ADD COLUMN     "needs_assistance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "catering_service" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickup_drop_service" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "psb_guide" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "vaccine_records" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "vaccine_type" "VaccineType" NOT NULL,
    "received" BOOLEAN NOT NULL DEFAULT false,
    "date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaccine_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vaccine_records_student_id_vaccine_type_key" ON "vaccine_records"("student_id", "vaccine_type");

-- AddForeignKey
ALTER TABLE "vaccine_records" ADD CONSTRAINT "vaccine_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
