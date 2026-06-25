-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('MEDIA_CONSENT', 'PARENT_CONSENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PCDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY');

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "consent_date" TIMESTAMP(3),
    "signed_by" TEXT,
    "notes" TEXT,
    "validity_period" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_attachments" (
    "id" TEXT NOT NULL,
    "consent_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_records" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "blood_type" TEXT,
    "health_info" TEXT,
    "special_needs" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passion_connection_activities" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "day" "PCDay" NOT NULL,
    "activity" TEXT NOT NULL,
    "academic_year_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passion_connection_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consent_records_student_id_consent_type_key" ON "consent_records"("student_id", "consent_type");

-- CreateIndex
CREATE UNIQUE INDEX "consent_attachments_object_key_key" ON "consent_attachments"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "health_records_student_id_key" ON "health_records"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "passion_connection_activities_student_id_day_academic_year__key" ON "passion_connection_activities"("student_id", "day", "academic_year_id");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_attachments" ADD CONSTRAINT "consent_attachments_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "consent_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_records" ADD CONSTRAINT "health_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
