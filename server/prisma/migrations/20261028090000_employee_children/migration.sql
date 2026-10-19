-- CreateEnum
CREATE TYPE "ChildRelation" AS ENUM ('BIOLOGICAL', 'ADOPTED', 'STEP');

-- CreateTable
CREATE TABLE "employee_children" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "relation" "ChildRelation" NOT NULL DEFAULT 'BIOLOGICAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_children_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_children_employee_id_idx" ON "employee_children"("employee_id");

-- AddForeignKey
ALTER TABLE "employee_children" ADD CONSTRAINT "employee_children_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
