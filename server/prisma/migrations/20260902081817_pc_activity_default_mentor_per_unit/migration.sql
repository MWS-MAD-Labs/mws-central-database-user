-- DropForeignKey
ALTER TABLE "master_pc_activities" DROP CONSTRAINT "master_pc_activities_default_mentor_id_fkey";

-- AlterTable
ALTER TABLE "master_pc_activities" DROP COLUMN "default_mentor_id";

-- CreateTable
CREATE TABLE "pc_activity_default_mentors" (
    "id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "mentor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pc_activity_default_mentors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pc_activity_default_mentors_activity_id_unit_id_key" ON "pc_activity_default_mentors"("activity_id", "unit_id");

-- AddForeignKey
ALTER TABLE "pc_activity_default_mentors" ADD CONSTRAINT "pc_activity_default_mentors_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "master_pc_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_default_mentors" ADD CONSTRAINT "pc_activity_default_mentors_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_default_mentors" ADD CONSTRAINT "pc_activity_default_mentors_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
