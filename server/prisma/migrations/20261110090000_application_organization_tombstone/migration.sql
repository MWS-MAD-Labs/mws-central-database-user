-- The Organization ID of a removed application, kept so adding the same application again gets the same ID.
CREATE TABLE "application_organization_tombstones" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "removed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_organization_tombstones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "application_organization_tombstones_application_id_key" ON "application_organization_tombstones"("application_id");
