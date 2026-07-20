#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: set DATABASE_URL to the mws-center connection string first." >&2
  exit 1
fi

case "$DATABASE_URL" in
  *mws-center*) ;;
  *)
    echo "Error: DATABASE_URL does not look like it points at mws-center. Aborting." >&2
    echo "  Got: $DATABASE_URL" >&2
    exit 1
    ;;
esac

echo "==> Target: $DATABASE_URL"

echo "==> Renaming can_create_data -> can_write_data (skipped if already renamed)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
DO \$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'can_create_data'
  ) THEN
    ALTER TABLE admin_users RENAME COLUMN can_create_data TO can_write_data;
  END IF;
END \$\$;
"

MIGRATIONS=(
  "20260625060758_core"
  "20260625061722_add_academic_structure"
  "20260625061910_add_parent_guardian"
  "20260625062017_add_consent_health_pc"
  "20260625062100_add_admin_user"
  "20260625071514_add_api_clients"
  "20260625072803_add_audit_import_sync"
  "20260625081036"
  "20260630014935_add_master_tables"
  "20260706045037_add_permission_field_to_admin_user"
  "20260713034430_add_new_table"
  "20260716014642_rename_can_create_data_to_can_write_data"
)

echo "==> Marking ${#MIGRATIONS[@]} migrations as applied"
for name in "${MIGRATIONS[@]}"; do
  echo "  - $name"
  bunx prisma migrate resolve --applied "$name"
done

echo "==> Done. Verifying status:"
bunx prisma migrate status
