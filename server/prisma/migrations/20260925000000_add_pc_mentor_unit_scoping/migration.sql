-- CreateTable
CREATE TABLE "employee_pc_mentor_units" (
    "employee_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "employee_pc_mentor_units_pkey" PRIMARY KEY ("employee_id","unit_id")
);

-- CreateTable
CREATE TABLE "intern_pc_mentor_units" (
    "intern_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "intern_pc_mentor_units_pkey" PRIMARY KEY ("intern_id","unit_id")
);

-- AddForeignKey
ALTER TABLE "employee_pc_mentor_units" ADD CONSTRAINT "employee_pc_mentor_units_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_pc_mentor_units" ADD CONSTRAINT "employee_pc_mentor_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intern_pc_mentor_units" ADD CONSTRAINT "intern_pc_mentor_units_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intern_pc_mentor_units" ADD CONSTRAINT "intern_pc_mentor_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
