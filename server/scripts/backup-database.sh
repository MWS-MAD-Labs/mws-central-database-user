#!/usr/bin/env bash
set -euo pipefail

# Dumps the Postgres database running in this repo's docker-compose stack,
# encrypts the dump with GPG (symmetric AES256) so the plaintext never
# leaves this host, uploads the encrypted file to an S3-compatible bucket
# (Cloudflare R2 by default), then prunes uploads older than
# BACKUP_RETENTION_DAYS. Meant to run on the Komodo host via cron - see
# docs/database-backup.md for setup.
#
# Only two host dependencies: docker (already required for this stack) and
# gpg. pg_dump and the S3 client both run inside containers (the compose
# stack's own `db` service, and amazon/aws-cli respectively) so this never
# depends on what happens to be installed on the host - and pg_dump always
# matches the server's own Postgres version exactly.
#
# Required env vars:
#   BACKUP_ENCRYPTION_PASSPHRASE  - symmetric GPG passphrase. Store this
#     somewhere other than this host (password manager, etc) - it's the
#     only thing standing between an R2 breach and a readable data dump.
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
#     - from the Cloudflare R2 dashboard (Manage R2 API Tokens).
#
# Optional env vars (sensible defaults for this repo's docker-compose.yml):
#   COMPOSE_PROJECT_DIR  - directory containing docker-compose.yml
#     (default: this script's repo root)
#   DB_CONTAINER  - compose service name for Postgres (default: db)
#   DB_NAME       - database name inside that container (default: mws-center)
#   DB_USER       - postgres user (default: root)
#   BACKUP_RETENTION_DAYS  - delete uploads older than this many days
#     (default: 30)
#   AWS_CLI_IMAGE - pinned amazon/aws-cli image (default: amazon/aws-cli:2.17.62)
#   S3_ENDPOINT_URL - overrides the derived R2 endpoint, for another
#     S3-compatible provider or for testing against a local MinIO

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${COMPOSE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DB_CONTAINER="${DB_CONTAINER:-db}"
DB_NAME="${DB_NAME:-mws-center}"
DB_USER="${DB_USER:-root}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.17.62}"

for var in BACKUP_ENCRYPTION_PASSPHRASE R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is required." >&2
    exit 1
  fi
done

command -v gpg >/dev/null 2>&1 || { echo "Error: gpg not found on this host." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Error: docker not found on this host." >&2; exit 1; }

# S3_ENDPOINT_URL overrides the derived R2 endpoint - lets this same script
# target any other S3-compatible provider (Backblaze B2, MinIO, ...) without
# editing it, and is how the test suite below points this at local MinIO.
R2_ENDPOINT="${S3_ENDPOINT_URL:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

DUMP_NAME="mws-center-${TIMESTAMP}.dump"
DUMP_FILE="$WORKDIR/$DUMP_NAME"
ENC_FILE="$DUMP_FILE.gpg"
ENC_NAME="$(basename "$ENC_FILE")"

echo "==> Dumping '$DB_NAME' from the '$DB_CONTAINER' container"
if ! ( cd "$PROJECT_DIR" && docker compose exec -T "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" ) > "$DUMP_FILE"; then
  echo "Error: pg_dump failed." >&2
  exit 1
fi
if [ ! -s "$DUMP_FILE" ]; then
  echo "Error: dump file is empty - aborting before upload." >&2
  exit 1
fi
echo "==> Dump size: $(du -h "$DUMP_FILE" | cut -f1)"

echo "==> Encrypting dump (AES256)"
gpg --batch --yes --pinentry-mode loopback \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --symmetric --cipher-algo AES256 \
  -o "$ENC_FILE" "$DUMP_FILE"
shred -u "$DUMP_FILE" 2>/dev/null || rm -f "$DUMP_FILE"

echo "==> Uploading to s3://$R2_BUCKET_NAME/postgres/$ENC_NAME"
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -v "$WORKDIR:/backup:ro" \
  "$AWS_CLI_IMAGE" \
  s3 cp "/backup/$ENC_NAME" "s3://$R2_BUCKET_NAME/postgres/$ENC_NAME" \
  --endpoint-url "$R2_ENDPOINT"

echo "==> Pruning uploads older than $BACKUP_RETENTION_DAYS days"
CUTOFF="$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v-"${BACKUP_RETENTION_DAYS}"d +%Y-%m-%dT%H:%M:%SZ)"

STALE_KEYS="$(docker run --rm --add-host=host.docker.internal:host-gateway \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  "$AWS_CLI_IMAGE" \
  s3api list-objects-v2 --bucket "$R2_BUCKET_NAME" --prefix "postgres/" \
  --endpoint-url "$R2_ENDPOINT" \
  --query "Contents[?LastModified<'$CUTOFF'].Key" --output text)"

if [ -n "$STALE_KEYS" ] && [ "$STALE_KEYS" != "None" ]; then
  echo "$STALE_KEYS" | tr '\t' '\n' | while IFS= read -r key; do
    [ -z "$key" ] && continue
    echo "  - deleting $key"
    docker run --rm --add-host=host.docker.internal:host-gateway \
      -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
      -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      "$AWS_CLI_IMAGE" \
      s3 rm "s3://$R2_BUCKET_NAME/$key" --endpoint-url "$R2_ENDPOINT"
  done
else
  echo "  (nothing to prune)"
fi

echo "==> Done: postgres/$ENC_NAME"
