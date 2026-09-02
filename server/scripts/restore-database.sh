#!/usr/bin/env bash
set -euo pipefail

# Downloads an encrypted backup made by backup-database.sh, decrypts it,
# and restores it into the 'db' container's database - OVERWRITING
# whatever is there now. Meant for disaster recovery, or for periodically
# proving a backup actually restores (a backup nobody has ever restored
# isn't a verified one). See docs/database-backup.md.
#
# Usage:
#   ./restore-database.sh                       # restores the newest backup
#   ./restore-database.sh postgres/mws-center-20260901T020000Z.dump.gpg
#                                                # restores a specific one
#
# Required env vars: same as backup-database.sh (BACKUP_ENCRYPTION_PASSPHRASE,
# R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).
# Optional: COMPOSE_PROJECT_DIR, DB_CONTAINER, DB_NAME, DB_USER, AWS_CLI_IMAGE
# (same meaning and defaults as backup-database.sh).
#
# RESTORE_INTO_NEW_DB=1 restores into a throwaway "<DB_NAME>_restore_test"
# database instead of overwriting DB_NAME - use this to verify a backup
# without touching live data.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${COMPOSE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DB_CONTAINER="${DB_CONTAINER:-db}"
DB_NAME="${DB_NAME:-mws-center}"
DB_USER="${DB_USER:-root}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.17.62}"
TARGET_DB="$DB_NAME"
if [ "${RESTORE_INTO_NEW_DB:-0}" = "1" ]; then
  TARGET_DB="${DB_NAME}_restore_test"
fi

for var in BACKUP_ENCRYPTION_PASSPHRASE R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is required." >&2
    exit 1
  fi
done

command -v gpg >/dev/null 2>&1 || { echo "Error: gpg not found on this host." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Error: docker not found on this host." >&2; exit 1; }

# S3_ENDPOINT_URL overrides the derived R2 endpoint - see backup-database.sh.
R2_ENDPOINT="${S3_ENDPOINT_URL:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

KEY="${1:-}"
if [ -z "$KEY" ]; then
  echo "==> No key given, finding the newest backup"
  KEY="$(docker run --rm --add-host=host.docker.internal:host-gateway \
    -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    "$AWS_CLI_IMAGE" \
    s3api list-objects-v2 --bucket "$R2_BUCKET_NAME" --prefix "postgres/" \
    --endpoint-url "$R2_ENDPOINT" \
    --query "sort_by(Contents, &LastModified)[-1].Key" --output text)"
  if [ -z "$KEY" ] || [ "$KEY" = "None" ]; then
    echo "Error: no backups found in s3://$R2_BUCKET_NAME/postgres/" >&2
    exit 1
  fi
fi
echo "==> Restoring from s3://$R2_BUCKET_NAME/$KEY"

ENC_NAME="$(basename "$KEY")"
ENC_FILE="$WORKDIR/$ENC_NAME"
DUMP_FILE="${ENC_FILE%.gpg}"

echo "==> Downloading"
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -v "$WORKDIR:/backup" \
  "$AWS_CLI_IMAGE" \
  s3 cp "s3://$R2_BUCKET_NAME/$KEY" "/backup/$ENC_NAME" \
  --endpoint-url "$R2_ENDPOINT"

echo "==> Decrypting"
gpg --batch --yes --pinentry-mode loopback \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  -o "$DUMP_FILE" -d "$ENC_FILE"
shred -u "$ENC_FILE" 2>/dev/null || rm -f "$ENC_FILE"

if [ "${RESTORE_INTO_NEW_DB:-0}" = "1" ]; then
  echo "==> Creating throwaway database '$TARGET_DB'"
  ( cd "$PROJECT_DIR" && docker compose exec -T "$DB_CONTAINER" \
    psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" \
    -c "CREATE DATABASE \"$TARGET_DB\";" )
else
  echo "!! This will OVERWRITE the '$TARGET_DB' database. Ctrl+C now to abort."
  echo "!! Restoring in 10 seconds..."
  sleep 10
fi

echo "==> Restoring into '$TARGET_DB'"
( cd "$PROJECT_DIR" && cat "$DUMP_FILE" | docker compose exec -T "$DB_CONTAINER" \
  pg_restore -U "$DB_USER" -d "$TARGET_DB" --clean --if-exists --no-owner )
shred -u "$DUMP_FILE" 2>/dev/null || rm -f "$DUMP_FILE"

echo "==> Restore complete: $TARGET_DB"
