-- CreateEnum
CREATE TYPE "EmployeeMutationField" AS ENUM ('UNIT', 'JOB_POSITION', 'JOB_LEVEL', 'BUILDING', 'STATUS');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ROLLBACK_EMPLOYEE_MUTATION';

-- CreateTable
CREATE TABLE "employee_mutation_histories" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "field" "EmployeeMutationField" NOT NULL,
    "unit_id" TEXT,
    "job_position_id" TEXT,
    "job_level_id" TEXT,
    "building_id" TEXT,
    "status" "EmployeeStatus",
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "previous_history_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employee_mutation_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_mutation_histories_previous_history_id_key" ON "employee_mutation_histories"("previous_history_id");

-- AddForeignKey
ALTER TABLE "employee_mutation_histories" ADD CONSTRAINT "employee_mutation_histories_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_mutation_histories" ADD CONSTRAINT "employee_mutation_histories_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_mutation_histories" ADD CONSTRAINT "employee_mutation_histories_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "master_job_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_mutation_histories" ADD CONSTRAINT "employee_mutation_histories_job_level_id_fkey" FOREIGN KEY ("job_level_id") REFERENCES "master_job_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_mutation_histories" ADD CONSTRAINT "employee_mutation_histories_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "master_buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_mutation_histories" ADD CONSTRAINT "employee_mutation_histories_previous_history_id_fkey" FOREIGN KEY ("previous_history_id") REFERENCES "employee_mutation_histories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
