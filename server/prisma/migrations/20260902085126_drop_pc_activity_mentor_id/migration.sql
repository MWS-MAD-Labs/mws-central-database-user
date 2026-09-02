-- DropForeignKey
ALTER TABLE "passion_connection_activities" DROP CONSTRAINT "passion_connection_activities_mentor_id_fkey";

-- AlterTable
ALTER TABLE "passion_connection_activities" DROP COLUMN "mentor_id";
