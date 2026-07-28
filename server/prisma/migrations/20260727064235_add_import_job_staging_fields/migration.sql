-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "field_mapping" JSONB,
ADD COLUMN     "staged_rows" JSONB;
