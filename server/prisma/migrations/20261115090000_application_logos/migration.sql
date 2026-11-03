-- Logos for applications, picked from the master data.
CREATE TABLE "application_logos" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_logos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "application_logos_name_key" ON "application_logos"("name");

ALTER TABLE "applications" ADD COLUMN "logo_id" TEXT;
ALTER TABLE "applications"
  ADD CONSTRAINT "applications_logo_id_fkey"
  FOREIGN KEY ("logo_id") REFERENCES "application_logos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE 'CREATE_APPLICATION_LOGO';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_APPLICATION_LOGO';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_APPLICATION_LOGO';
