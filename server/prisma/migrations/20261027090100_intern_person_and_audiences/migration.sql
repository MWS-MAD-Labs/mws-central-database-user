-- An intern email that already belongs to another person cannot become a person of its own. Stop here and say which.
DO $$
DECLARE
  clash TEXT;
BEGIN
  SELECT string_agg(i."email", ', ') INTO clash
  FROM "interns" i
  JOIN "persons" p ON lower(p."email") = lower(i."email");
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'These intern emails already belong to another person: %. Change or remove one of them, then run the migration again.', clash;
  END IF;
END $$;

-- Every intern becomes a person, like an employee or a student. A blank birth place or date gets the same
-- placeholder as the import.
ALTER TABLE "interns" ADD COLUMN "person_id" TEXT;
UPDATE "interns" SET "person_id" = gen_random_uuid()::text;

INSERT INTO "persons" ("id", "full_name", "nick_name", "email", "person_type", "gender", "religion", "religion_other", "birth_place", "birth_date", "created_at", "updated_at")
SELECT "person_id", "full_name", "nick_name", "email", 'INTERN', "gender", "religion", "religion_other",
       COALESCE("birth_place", 'Unknown'), COALESCE("birth_date", TIMESTAMP '1900-01-01 00:00:00'), "created_at", "updated_at"
FROM "interns";

ALTER TABLE "interns" ALTER COLUMN "person_id" SET NOT NULL;
CREATE UNIQUE INDEX "interns_person_id_key" ON "interns"("person_id");
ALTER TABLE "interns" ADD CONSTRAINT "interns_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Group access: who a group is for becomes three flags, like the roles.
ALTER TABLE "application_access_rules"
  ADD COLUMN "for_employees" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "for_interns" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "for_students" BOOLEAN NOT NULL DEFAULT false;
UPDATE "application_access_rules"
SET "for_employees" = "audience" IN ('EMPLOYEES', 'EMPLOYEES_AND_STUDENTS'),
    "for_students" = "audience" IN ('STUDENTS', 'EMPLOYEES_AND_STUDENTS');
ALTER TABLE "application_access_rules" DROP COLUMN "audience";
DROP TYPE "ApplicationAudience";

-- A role says whether interns may be given it.
ALTER TABLE "application_roles" ADD COLUMN "allows_interns" BOOLEAN NOT NULL DEFAULT false;
