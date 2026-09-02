-- AlterTable
ALTER TABLE "master_pc_activities" ADD COLUMN     "default_mentor_id" TEXT;

-- AddForeignKey
ALTER TABLE "master_pc_activities" ADD CONSTRAINT "master_pc_activities_default_mentor_id_fkey" FOREIGN KEY ("default_mentor_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
