-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('SD', 'SMP', 'SMA_SMK', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "education_level" "EducationLevel",
ADD COLUMN     "graduation_year" INTEGER,
ADD COLUMN     "institution_name" TEXT,
ADD COLUMN     "major" TEXT;
