# Database backup

The Postgres database backing this app runs in a Docker named volume
(`pgdata` in `docker-compose.yml`), self-hosted, with no automatic backups
from any cloud vendor. If that volume is lost, there's nothing to recover
from unless the process below has actually been running.

`server/scripts/backup-database.sh` dumps the database, encrypts the dump
with GPG (AES256, symmetric passphrase) before it ever leaves the host,
uploads the encrypted file to a Cloudflare R2 bucket, and prunes uploads
older than the retention window. `server/scripts/restore-database.sh`
reverses that. Both were tested end to end against a real dump of this
project's dev database (703 students, 14 enrollments) restored into a
throwaway database with matching row counts, using a local MinIO bucket in
place of R2.

Encryption matters here specifically because this database holds sensitive
data - employee NIK/NPWP/bank details, student health records, and so on.
An encrypted-at-rest backup means a breach of the R2 bucket alone doesn't
expose that data; the passphrase is the only thing that can open it, and it
never touches R2.

## One-time setup

### 1. Create the R2 bucket

1. Cloudflare dashboard → R2 → Create bucket. Any name (e.g. `mws-backups`).
2. R2 → Manage R2 API Tokens → Create API Token. Give it **Object Read &
   Write**, scoped to that bucket only.
3. Note down the Account ID (shown on the R2 overview page), the Access
   Key ID, and the Secret Access Key - the secret is only shown once.

R2's free tier is 10 GB storage with no egress fee, which comfortably
covers daily Postgres dumps of a database this size for a long time.

### 2. Generate an encryption passphrase

Anything long and random works, e.g.:

```bash
openssl rand -base64 32
```

Save it in a password manager, or wherever the project already keeps
production secrets. **Not in this repo, not on the same server as the
database if avoidable.** Losing this passphrase makes every backup useless;
leaking it alongside the backups makes the encryption useless.

### 3. Set the environment variables on the Komodo host

```bash
export BACKUP_ENCRYPTION_PASSPHRASE="<from step 2>"
export R2_ACCOUNT_ID="<from step 1>"
export R2_ACCESS_KEY_ID="<from step 1>"
export R2_SECRET_ACCESS_KEY="<from step 1>"
export R2_BUCKET_NAME="mws-backups"
```

Wherever cron picks up its environment on that host (a `/etc/environment`
entry, a sourced file referenced from the crontab, whatever's already used
for `DATABASE_URL` and the other secrets in `docker-compose.yml`) - these
five need to land there too, since cron jobs don't inherit a login shell's
environment by default.

### 4. Run a backup by hand once

From the repo root (where `docker-compose.yml` lives), with the stack up:

```bash
./server/scripts/backup-database.sh
```

Expected output ends with `==> Done: postgres/mws-center-<timestamp>.dump.gpg`.
Check the bucket in the Cloudflare dashboard - the object should be there.

### 5. Verify a restore actually works

A backup that has never been restored isn't a verified backup. This
restores into a **throwaway database** (`mws-center_restore_test`) rather
than touching the real one:

```bash
RESTORE_INTO_NEW_DB=1 ./server/scripts/restore-database.sh
```

Then spot-check it:

```bash
docker compose exec db psql -U root -d mws-center_restore_test \
  -c "SELECT count(*) FROM students;"
```

Compare against the same query against `mws-center` - they should match
(assuming no writes happened between the backup and this check). Drop the
throwaway database once satisfied:

```bash
docker compose exec db psql -U root -d postgres \
  -c "DROP DATABASE mws-center_restore_test;"
```

### 6. Schedule it

Add to the Komodo host's crontab (`crontab -e`), e.g. daily at 2 AM:

```cron
0 2 * * * cd /path/to/mws-data-center && ./server/scripts/backup-database.sh >> /var/log/mws-db-backup.log 2>&1
```

Check `/var/log/mws-db-backup.log` after the first scheduled run to confirm
it actually fired and succeeded - don't just assume the cron line is
correct.

## Restoring for real

```bash
# restores the newest backup, OVERWRITING the live mws-center database
./server/scripts/restore-database.sh

# restores a specific one instead
./server/scripts/restore-database.sh postgres/mws-center-20260901T020000Z.dump.gpg
```

The script pauses 10 seconds before overwriting anything (Ctrl+C to abort)
- it's not asking for typed confirmation, so don't run it against a live
database without being sure.

## What isn't covered here

- **MinIO** (student/employee photos, consent attachments) and **Redis**
  are also self-hosted volumes with no backup automation. This document is
  Postgres only; the same total-loss risk applies to those two until
  they're covered too.
- This backs up the database, not the application code or environment
  secrets (`.env`, `JWT_SECRET`, Google OAuth credentials) - keep those in
  whatever secret manager or password vault the team already uses.
