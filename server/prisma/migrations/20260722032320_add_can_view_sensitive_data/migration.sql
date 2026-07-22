-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "can_view_sensitive_data" BOOLEAN NOT NULL DEFAULT false;
