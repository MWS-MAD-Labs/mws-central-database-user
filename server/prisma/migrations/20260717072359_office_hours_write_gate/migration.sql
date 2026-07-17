-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "after_hours_write_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "working_day_overrides" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "working_day_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "working_day_overrides_date_key" ON "working_day_overrides"("date");
