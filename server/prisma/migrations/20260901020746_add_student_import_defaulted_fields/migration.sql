-- AlterTable
ALTER TABLE "students" ADD COLUMN     "import_defaulted_fields" TEXT[] DEFAULT ARRAY[]::TEXT[];
