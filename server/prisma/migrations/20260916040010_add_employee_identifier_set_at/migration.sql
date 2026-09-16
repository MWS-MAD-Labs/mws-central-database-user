-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "nik_set_at" TIMESTAMP(3),
ADD COLUMN     "npwp_set_at" TIMESTAMP(3),
ADD COLUMN     "bank_account_number_set_at" TIMESTAMP(3),
ADD COLUMN     "bpjs_number_set_at" TIMESTAMP(3),
ADD COLUMN     "bpjs_employment_number_set_at" TIMESTAMP(3),
ADD COLUMN     "kpj_number_set_at" TIMESTAMP(3);
