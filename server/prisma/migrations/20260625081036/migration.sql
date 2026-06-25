/*
  Warnings:

  - A unique constraint covering the columns `[refresh_token_hash]` on the table `admin_users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "refresh_token_exp" TIMESTAMP(3),
ADD COLUMN     "refresh_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_refresh_token_hash_key" ON "admin_users"("refresh_token_hash");
