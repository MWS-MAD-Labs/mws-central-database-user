-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_ACADEMIC_SEMESTER';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_ACADEMIC_SEMESTER';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_ACADEMIC_SEMESTER';

-- CreateTable
CREATE TABLE "academic_semesters" (
    "id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_semesters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_semesters_academic_year_id_position_key" ON "academic_semesters"("academic_year_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "academic_semesters_academic_year_id_name_key" ON "academic_semesters"("academic_year_id", "name");

-- AddForeignKey
ALTER TABLE "academic_semesters" ADD CONSTRAINT "academic_semesters_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
