-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "kpj_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "employees_kpj_number_key" ON "employees"("kpj_number");
