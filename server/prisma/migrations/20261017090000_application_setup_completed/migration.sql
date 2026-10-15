-- AlterTable
ALTER TABLE "applications" ADD COLUMN "setup_completed_at" TIMESTAMP(3);

-- An application that is already shown in the Hub has finished its setup.
UPDATE "applications" SET "setup_completed_at" = "updated_at" WHERE "published" = true;
