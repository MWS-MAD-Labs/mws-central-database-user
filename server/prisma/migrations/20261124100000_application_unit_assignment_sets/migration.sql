CREATE TABLE "application_unit_assignment_sets" (
  "application_id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "permission_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "application_unit_assignment_sets_pkey" PRIMARY KEY ("application_id", "unit_id", "permission_key"),
  CONSTRAINT "application_unit_assignment_sets_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
