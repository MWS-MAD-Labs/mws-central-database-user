-- Units a person's role reaches in an application. Empty means their own unit.
ALTER TABLE "application_entitlements"
  ADD COLUMN "scope_unit_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
