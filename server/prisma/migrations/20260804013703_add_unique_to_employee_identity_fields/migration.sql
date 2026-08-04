-- AlterTable: add unique constraints on employee identity/sensitive fields
CREATE UNIQUE INDEX "employees_nik_key" ON "employees"("nik");
CREATE UNIQUE INDEX "employees_npwp_key" ON "employees"("npwp");
CREATE UNIQUE INDEX "employees_bank_account_number_key" ON "employees"("bank_account_number");
CREATE UNIQUE INDEX "employees_bpjs_number_key" ON "employees"("bpjs_number");
CREATE UNIQUE INDEX "employees_bpjs_employment_number_key" ON "employees"("bpjs_employment_number");
