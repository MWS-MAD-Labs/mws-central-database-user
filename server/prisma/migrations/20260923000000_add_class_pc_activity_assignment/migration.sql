-- CreateTable
CREATE TABLE "class_passion_connection_activities" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "day" "PCDay" NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "class_passion_connection_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_passion_connection_activities_class_id_idx" ON "class_passion_connection_activities"("class_id");

-- CreateIndex (partial - excludes soft-deleted offerings, same pattern as pc_activities_student_day_year_active_key)
CREATE UNIQUE INDEX "class_pc_activities_class_activity_year_day_active_key" ON "class_passion_connection_activities"("class_id", "activity_id", "academic_year_id", "day") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "class_passion_connection_activities" ADD CONSTRAINT "class_passion_connection_activities_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_passion_connection_activities" ADD CONSTRAINT "class_passion_connection_activities_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "master_pc_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_passion_connection_activities" ADD CONSTRAINT "class_passion_connection_activities_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "passion_connection_activities" ADD COLUMN "class_activity_id" TEXT;

-- AddForeignKey
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_class_activity_id_fkey" FOREIGN KEY ("class_activity_id") REFERENCES "class_passion_connection_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
