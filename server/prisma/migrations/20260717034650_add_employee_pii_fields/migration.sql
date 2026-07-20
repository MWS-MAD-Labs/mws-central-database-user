-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "bank_account_number" TEXT,
ADD COLUMN     "bpjs_number" TEXT,
ADD COLUMN     "marital_status" "MaritalStatus",
ADD COLUMN     "mobile_phone" TEXT,
ADD COLUMN     "nik" TEXT,
ADD COLUMN     "residential_address" TEXT;
