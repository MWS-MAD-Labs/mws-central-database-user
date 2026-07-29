-- CreateEnum
CREATE TYPE "StudentEntryType" AS ENUM ('PRE_K', 'PSB', 'TRANSFER');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "entry_type" "StudentEntryType" NOT NULL DEFAULT 'PSB';
