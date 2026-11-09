CREATE TABLE "student_special_needs" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "need_type" "SpecialNeedType" NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_special_needs_pkey" PRIMARY KEY ("id")
);

INSERT INTO "student_special_needs" (
    "id",
    "profile_id",
    "need_type",
    "description",
    "created_at",
    "updated_at"
)
SELECT
    CONCAT(profile."id", ':', need."need_type"::text),
    profile."id",
    need."need_type",
    profile."description",
    profile."created_at",
    profile."updated_at"
FROM "student_special_needs_profiles" profile
CROSS JOIN LATERAL UNNEST(profile."need_types") AS need("need_type");

CREATE UNIQUE INDEX "student_special_needs_profile_id_need_type_key"
ON "student_special_needs"("profile_id", "need_type");

ALTER TABLE "student_special_needs"
ADD CONSTRAINT "student_special_needs_profile_id_fkey"
FOREIGN KEY ("profile_id") REFERENCES "student_special_needs_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_special_needs_profiles"
DROP COLUMN "need_types",
DROP COLUMN "description";
