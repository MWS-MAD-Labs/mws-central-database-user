-- CreateEnum
CREATE TYPE "SpecialNeedType" AS ENUM ('LEARNING', 'COGNITIVE', 'COMMUNICATION', 'SOCIAL_EMOTIONAL', 'PHYSICAL', 'SENSORY', 'OTHER');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_SPECIAL_NEEDS_PROFILE';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_SPECIAL_NEEDS_PROFILE';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_SPECIAL_NEEDS_PROFILE';

-- CreateTable
CREATE TABLE "student_special_needs_profiles" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "need_types" "SpecialNeedType"[],
    "description" VARCHAR(1000) NOT NULL,
    "learning_support_summary" VARCHAR(500),
    "accommodations" VARCHAR(1000),
    "has_professional_report" BOOLEAN NOT NULL DEFAULT false,
    "report_date" DATE,
    "identified_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_special_needs_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_special_needs_profiles_student_id_key" ON "student_special_needs_profiles"("student_id");

-- AddForeignKey
ALTER TABLE "student_special_needs_profiles" ADD CONSTRAINT "student_special_needs_profiles_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The old one-line Special Needs notes become the description of a profile, kept as type Other.
-- The notes stay where they are, so nothing is lost.
INSERT INTO "student_special_needs_profiles" ("id", "student_id", "need_types", "description", "updated_at")
SELECT 'snp_' || md5(n."student_id"), n."student_id", ARRAY['OTHER']::"SpecialNeedType"[], LEFT(n."description", 1000), CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("student_id") "student_id", "description"
  FROM "health_notes"
  WHERE "category" = 'SPECIAL_NEEDS' AND "status" = 'ACTIVE' AND "deleted_at" IS NULL
  ORDER BY "student_id", "noted_date" DESC
) n
JOIN "students" s ON s."id" = n."student_id" AND s."deleted_at" IS NULL AND s."sn" = true;
