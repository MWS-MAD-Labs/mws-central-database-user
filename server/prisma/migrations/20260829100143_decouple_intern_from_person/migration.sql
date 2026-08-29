-- AlterEnum
BEGIN;
CREATE TYPE "PersonType_new" AS ENUM ('STUDENT', 'EMPLOYEE');
ALTER TABLE "persons" ALTER COLUMN "person_type" TYPE "PersonType_new" USING ("person_type"::text::"PersonType_new");
ALTER TYPE "PersonType" RENAME TO "PersonType_old";
ALTER TYPE "PersonType_new" RENAME TO "PersonType";
DROP TYPE "public"."PersonType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "interns" DROP CONSTRAINT "interns_person_id_fkey";

-- DropIndex
DROP INDEX "interns_person_id_key";

-- AlterTable
ALTER TABLE "interns" DROP COLUMN "person_id",
ADD COLUMN     "birth_date" TIMESTAMP(3),
ADD COLUMN     "birth_place" TEXT,
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "full_name" TEXT NOT NULL,
ADD COLUMN     "gender" "Gender" NOT NULL,
ADD COLUMN     "nick_name" TEXT NOT NULL,
ADD COLUMN     "religion" "Religion" NOT NULL,
ADD COLUMN     "religion_other" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "interns_email_key" ON "interns"("email");

