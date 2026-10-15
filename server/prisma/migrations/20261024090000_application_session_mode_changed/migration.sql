-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "session_mode_changed_at" TIMESTAMP(3),
ADD COLUMN     "session_mode_confirmed_at" TIMESTAMP(3);
