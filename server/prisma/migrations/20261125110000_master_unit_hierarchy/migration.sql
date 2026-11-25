ALTER TABLE "master_units"
ADD COLUMN "parent_id" TEXT;

CREATE INDEX "master_units_parent_id_idx" ON "master_units"("parent_id");

ALTER TABLE "master_units"
ADD CONSTRAINT "master_units_parent_id_fkey"
FOREIGN KEY ("parent_id") REFERENCES "master_units"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
