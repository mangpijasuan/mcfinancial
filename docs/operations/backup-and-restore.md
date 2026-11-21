# Backups and Restore

The club's records exist in one PostgreSQL database. This runbook keeps an encrypted copy of it off the server every night, and proves every week that the copy can actually be restored (S-6).

**Targets:** lose at most one day of data (recovery point 24 h); be running again within 4 hours of deciding to restore (recovery time 4 h).

## How it works

```
 production server                          object storage (off-site)
 ─────────────────                          ───────────────────────────
 pg_dump ─► age (public key) ─► file ─────► mc-club-backups/postgres/
            server can write,               versioned, object lock,
            cannot read                     write-only key, 90-day expiry
                                                        │
 officer's laptop (weekly)                              │
 ─────────────────────────                              ▼
 restore-postgres.sh verify  ◄── age (private key) ◄── newest backup
   → throwaway database → checks → PASS / FAIL → dropped
```

- **Encryption:** each backup is encrypted with [age](https://age-encryption.org) to the club's backup **public** key(s). The private key never touches the server, so a compromised server cannot read old backups.
- **Off-site:** backups are copied with [rclone](https://rclone.org) to object storage (Hetzner Object Storage, Backblaze B2, or any S3-compatible service) in a different location from the server. The server's credentials can **add** files but not delete or overwrite them. Retention is enforced by the bucket, so a compromised server cannot wipe the backups either.
- **Monitoring:** each run pings a health check (for example [healthchecks.io](https://healthchecks.io)). If a nightly ping is missed, the Treasurer gets an email.
- **Proof:** once a week, an officer restores the newest backup into a throwaway database. The run checks the migrations, the key tables, that there is at least one member and one active staff account, and that the audit log is still append-only. It then deletes the throwaway database.

## One-time setup

### 1. Create the backup key (on an officer's computer, not the server)

```bash
age-keygen -o mc-backup-identity.txt       # the PRIVATE key
age-keygen -y mc-backup-identity.txt       # prints the public key: age1...
```

- Store `mc-backup-identity.txt` in the club's password manager, **and** keep a printed copy in a sealed envelope with the Treasurer. Without it, no backup can ever be restored.
- For resilience, create a second key held by another officer. Backups are encrypted to every public key listed, and either private key can restore them.

### 2. Create the storage bucket

In the storage provider:

1. Create a bucket (for example `mc-club-backups`) with a **different company or region** from the server.
2. Turn on **versioning** and, if offered, **object lock** in governance or compliance mode with 30-day retention. (On Backblaze B2, Object Lock can only be turned on when the bucket is created.)
3. Add a **lifecycle rule** that deletes objects older than 90 days. (B2: custom lifecycle, hide after 90 days, delete 1 day after hiding.)
4. Create an access key limited to that bucket, with **write (put) permission only** — no delete. (B2: *Application Keys* → one bucket → **Write Only**.) Save the key ID and key in the password manager: the key is shown once.

A write-only key usually cannot list the bucket either, so the backup script cannot read the size back after uploading; it says so in its log and relies on rclone's upload check. The weekly restore check (below) is what proves the backups.

### 3. Configure the server

On the server (as `root`, in `~/mcfinancial`; with another user, use its home directory in the paths):

```bash
apt-get install -y age rclone
mkdir -p ~/.config/mc-backup && chmod 700 ~/.config/mc-backup
read -rp 'First public key (age1...): ' K1
read -rp 'Second public key, or empty: ' K2
printf '%s\n' "$K1" ${K2:+"$K2"} > ~/.config/mc-backup/recipients.txt
```

Create `.env.backup` next to `docker-compose.hetzner.yml` (it is git-ignored). The storage key goes in the environment, so no `rclone config` file is needed; the keys are typed at hidden prompts:

```bash
read -rsp 'Storage key ID: ' ID; echo
read -rsp 'Storage application key: ' KEY; echo
read -rp  'Bucket name: ' BUCKET
read -rp  'Healthchecks ping URL: ' PING
( umask 077; cat > .env.backup <<ENV
BACKUP_AGE_RECIPIENTS_FILE=$HOME/.config/mc-backup/recipients.txt
BACKUP_REMOTE=mcbackup:$BUCKET/postgres
BACKUP_HEALTHCHECK_URL='$PING'
RCLONE_CONFIG_MCBACKUP_TYPE=b2
RCLONE_CONFIG_MCBACKUP_ACCOUNT='$ID'
RCLONE_CONFIG_MCBACKUP_KEY='$KEY'
ENV
)
unset ID KEY
```

(For a provider other than B2, set `RCLONE_CONFIG_MCBACKUP_TYPE` and its settings as rclone documents, or use `rclone config` to create a remote named `mcbackup`.)

Run it once by hand, then schedule it:

```bash
./scripts/ops/backup-postgres.sh
(crontab -l 2>/dev/null || true; echo '15 3 * * * cd '"$PWD"' && ./scripts/ops/backup-postgres.sh >> /var/log/mc-backup.log 2>&1') | crontab -
```

The script refuses to run if a **private** key is put in the recipients file.

## Weekly restore check (an officer, from their computer)

Needs Docker, `age`, `rclone` (with a **read-only** key to the bucket) and PostgreSQL 16 client tools.

```bash
npm run db:up                          # local scratch Postgres (Docker, port 5434)
export AGE_IDENTITY_FILE=~/secure/mc-backup-identity.txt
export BACKUP_REMOTE=mcbackup-read:mc-club-backups/postgres
./scripts/ops/restore-postgres.sh verify
```

The last line reads **PASS** or **FAIL**. A FAIL, or a newest backup more than 30 hours old, means the backups are not working: fix it the same day. Optionally set `VERIFY_HEALTHCHECK_URL` so a missed weekly check is noticed too.

## Disaster recovery (the server or database is lost)

1. **Decide.** The Treasurer and one other officer agree to restore, and note the time. Everything after the last backup must be re-entered from bank records and the audit trail.
2. **Get a server.** Follow [deploy-hetzner-postgres.md](deploy-hetzner-postgres.md) steps 1–6 on a new server (same `.env.production`, including `MFA_ENCRYPTION_KEY`). Staff authenticators keep working only with the same key.
3. **Restore.** The database must be new and empty. Run this from an officer's computer against the new server's database (for example over an SSH tunnel):

   ```bash
   export AGE_IDENTITY_FILE=~/secure/mc-backup-identity.txt BACKUP_REMOTE=mcbackup-read:mc-club-backups/postgres
   rclone lsf mcbackup-read:mc-club-backups/postgres | sort | tail -3   # pick the newest good one
   ./scripts/ops/restore-postgres.sh restore mcfinancial-YYYYMMDDTHHMMSSZ.dump.age 'postgresql://mcfinancial:…@localhost:15432/mcfinancial'
   ```

   The restore is a single transaction: it either loads completely or changes nothing. It prints row counts and checks the audit log.
4. **Start the app:** `docker compose -f docker-compose.hetzner.yml up -d`, then `exec app npx prisma migrate deploy`.
5. **Reconcile** the days since the backup against bank statements, re-enter them, and write down what happened for the board.

## Changing keys

- **An officer leaves:** remove their public key from `recipients.txt` on the server. New backups stop being readable with their key; old ones remain so until the bucket expires them. If the key may be compromised, create a new key, rotate the storage access keys, and re-run a restore check with the new key.
- **Lost private key:** backups made to that key alone cannot be restored. This is why two keys held by two officers are recommended.
