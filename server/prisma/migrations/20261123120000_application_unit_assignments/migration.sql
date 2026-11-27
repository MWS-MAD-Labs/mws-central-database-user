CREATE TABLE "application_unit_assignments" (
  "id" TEXT NOT NULL,
  "application_id" TEXT NOT NULL,
  "person_id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "permission_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "application_unit_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_unit_assignments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "application_unit_assignments_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "application_unit_assignments_application_id_person_id_unit_id_permission_key_key"
  ON "application_unit_assignments"("application_id", "person_id", "unit_id", "permission_key");
CREATE INDEX "application_unit_assignments_application_id_unit_id_permission_key_idx"
  ON "application_unit_assignments"("application_id", "unit_id", "permission_key");
