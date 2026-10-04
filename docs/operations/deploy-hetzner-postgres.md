# Hetzner + PostgreSQL Deployment

PostgreSQL is the database in every environment. Schema changes ship as Prisma migrations in `prisma/migrations/`. Keep Google Sheets only for import/export workflows.

## Recommended architecture

- 1 Hetzner Cloud VM for the app stack
- Docker Compose for `app`, `postgres`, and `caddy`
- PostgreSQL as the production database
- Optional later: move PostgreSQL to a second VM or managed provider

## Why PostgreSQL

- Better fit for concurrent writes and relational data
- Better production choice for members, loans, payments, and agreements
- Works directly with Prisma

## Files added for production

- `Dockerfile`
- `docker-compose.hetzner.yml`
- `Caddyfile`
- `.env.hetzner.example` (domain and database password, read by Docker Compose)
- `.env.production.example` (the app's settings)

Run every `docker compose` command below from the project directory: Compose reads `.env` from there.

## 1. Create a Hetzner server

Recommended starting point:

- Ubuntu 24.04
- 2 vCPU
- 4 GB RAM
- 80 GB SSD

Open inbound ports:

- `22` for SSH
- `80` for HTTP
- `443` for HTTPS

## 2. Point your domain

Create DNS records pointing your domain to the Hetzner server IP.

Example:

- `A` record for `admin.your-domain.example`

## 3. Install Docker on the server

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

## 4. Get the code onto the server

The repository is private, so give the server a read-only deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mcfinancial_deploy -N ""
cat ~/.ssh/mcfinancial_deploy.pub
```

On GitHub, open the repository's **Settings → Deploy keys → Add deploy key**, paste the key, and leave "Allow write access" off. Then:

```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/mcfinancial_deploy' git clone git@github.com:mangpijasuan/mcfinancial.git ~/mcfinancial
cd ~/mcfinancial
git config core.sshCommand 'ssh -i ~/.ssh/mcfinancial_deploy'
```

## 5. Create the two settings files

Neither file is ever committed. Keep a copy of both with the club's other secrets.

```bash
cp .env.hetzner.example .env
cp .env.production.example .env.production
chmod 600 .env .env.production   # only your user can read the secrets
openssl rand -hex 24       # database password
openssl rand -base64 32    # NEXTAUTH_SECRET
openssl rand -base64 32    # MFA_ENCRYPTION_KEY (a different value)
```

In `.env`:

- `DOMAIN`: the admin panel's address, e.g. `admin.your-domain.example`
- `POSTGRES_PASSWORD`: the database password (the stack refuses to start while it is empty)

In `.env.production`:

- `NEXTAUTH_URL`: `https://` plus the same domain
- `NEXTAUTH_SECRET`
- `MFA_ENCRYPTION_KEY` (losing it means every staff member sets up two-factor authentication again)
- `DATABASE_URL`: replace `change-me` with the database password from `.env`
- `SECURITY_ALERT_EMAIL` (receives an alert on every Super Admin sign-in)
- `RESEND_API_KEY`, `ADMIN_EMAIL`, `EMAIL_FROM` for email
- `STRIPE_*` and `NEXT_PUBLIC_ZELLE_*` for online payments, if used
- leave `MAKER_CHECKER_ENFORCED` and `LATE_FEES_ENABLED` at `"false"` until Gate #1 A4 and A7 are settled

## 6. Bring up the stack

The domain's DNS record must already point at the server, so Caddy can obtain the HTTPS certificate.

```bash
docker compose -f docker-compose.hetzner.yml up -d --build
docker compose -f docker-compose.hetzner.yml ps    # app and postgres: "healthy"
```

The first build takes a few minutes.

## 7. Initialize the database

**New installation** (empty database):

```bash
docker compose -f docker-compose.hetzner.yml exec app npx prisma migrate deploy

# The first Super Admin (sets up two-factor authentication at first sign-in).
# The password is typed at a hidden prompt, so it stays out of shell history.
read -rsp 'Password (12+ characters): ' NEW_ADMIN_PASSWORD; echo; export NEW_ADMIN_PASSWORD
docker compose -f docker-compose.hetzner.yml exec \
  -e ADMIN_EMAIL_TO_RESET=you@your-domain.example -e NEW_ADMIN_PASSWORD \
  app npm run admin:reset-password
unset NEW_ADMIN_PASSWORD
```

To load the club's records, upload the decrypted data file (README, "Real club data") straight into a private file (`chmod 600 club-data.json`), copy it into the container, seed from it, and delete both copies:

```bash
read -rsp 'Admin password (12+ characters): ' ADMIN_SEED_PASSWORD; echo; export ADMIN_SEED_PASSWORD
docker compose -f docker-compose.hetzner.yml cp club-data.json app:/tmp/club-data.json
docker compose -f docker-compose.hetzner.yml exec \
  -e SEED_DATA_FILE=/tmp/club-data.json -e ADMIN_SEED_PASSWORD \
  app npx prisma db seed
docker compose -f docker-compose.hetzner.yml exec -u root app rm /tmp/club-data.json
shred -u club-data.json
unset ADMIN_SEED_PASSWORD
```

The seed refuses to load demo data in production.

**Existing installation created with `prisma db push`** (before migrations existed) — baseline it once. Take a backup first — `scripts/ops/backup-postgres.sh` if encrypted backups are already set up (step 9), otherwise `(umask 077; docker compose -f docker-compose.hetzner.yml exec -T postgres pg_dump -Fc -U mcfinancial mcfinancial > pre-migration.dump)`, copied off the server and then shredded — then compare the live schema with the current one:

```bash
docker compose -f docker-compose.hetzner.yml exec app \
  sh -c 'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script'
```

The output should contain **only** the `AuditLog` table and its three indexes (added by the second migration, `20260926010000_audit_log`). Do not apply those by hand: `migrate deploy` creates them together with the append-only trigger.

- If anything else appears (for example `CREATE TABLE "PortalPayment"`, when the server predates online payments), apply just those statements with `npx prisma db execute --stdin < extra.sql`, then re-run the check.
- Then mark the baseline as applied and apply the remaining migrations:
  ```bash
  docker compose -f docker-compose.hetzner.yml exec app npx prisma migrate resolve --applied 20260926000000_init
  docker compose -f docker-compose.hetzner.yml exec app npx prisma migrate deploy
  ```

**Upgrading to roles and two-factor authentication** (migration `20260926020000_rbac_mfa`): set `MFA_ENCRYPTION_KEY` in `.env.production` *before* deploying. The migration turns each existing Super Admin into a Super Admin role holder and every other admin into the transitional Club Officer role (the audit log records each one). Every staff member is asked to set up two-factor authentication at their next sign-in, so tell them to have their phone ready.

**Upgrading to one login table** (migration `20261007000000_identity_users`, M8): nothing to set beforehand. The migration renames `Admin` to `User` (staff keep their ids, passwords and authenticators) and gives every member with a portal password a member login with the same password, so nobody signs in differently. Afterwards, check that the number of member logins matches the members who had portal access:

```bash
docker compose -f docker-compose.hetzner.yml exec -T postgres psql -U mcfinancial mcfinancial -c \
  "SELECT (SELECT count(*) FROM \"Member\" WHERE \"portalPassword\" IS NOT NULL) AS had_password, (SELECT count(*) FROM \"User\" WHERE kind = 'member') AS member_logins"
```

**Every deploy after that** (migrations run before the new version starts):

```bash
cd ~/mcfinancial
./scripts/ops/backup-postgres.sh
git pull
docker compose -f docker-compose.hetzner.yml build app
docker compose -f docker-compose.hetzner.yml run --rm --no-deps app npx prisma migrate deploy
docker compose -f docker-compose.hetzner.yml up -d
```

Until encrypted backups are set up (step 9), take a private, unencrypted dump instead of running the backup script. Copy it somewhere safe off the server, then delete it (`shred -u pre-deploy.dump`):

```bash
(umask 077; docker compose -f docker-compose.hetzner.yml exec -T postgres pg_dump -Fc -U mcfinancial mcfinancial > pre-deploy.dump)
```

**A server set up before `.env` existed** used the password `change-me`, and the database keeps the password it was created with. Put `POSTGRES_PASSWORD=change-me` in `.env` at first, then change it:

```bash
docker compose -f docker-compose.hetzner.yml exec postgres psql -U mcfinancial -d mcfinancial
# at the psql prompt (asks twice, nothing is echoed or saved in history):
\password mcfinancial
\q
```

Then put the new password in `.env` and in `DATABASE_URL` in `.env.production`, and run `docker compose -f docker-compose.hetzner.yml up -d`.

Never run `prisma db push` or `prisma migrate reset` against production.

The `AuditLog` table is append-only: a database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`. It is included in the nightly `pg_dump` backups; keep it when restoring.

**Admin password reset** (no default passwords exist):

```bash
read -rsp 'New password (12+ characters): ' NEW_ADMIN_PASSWORD; echo; export NEW_ADMIN_PASSWORD
docker compose -f docker-compose.hetzner.yml exec \
  -e ADMIN_EMAIL_TO_RESET=admin@mcfinancial.local -e NEW_ADMIN_PASSWORD \
  app npm run admin:reset-password
unset NEW_ADMIN_PASSWORD
```

Add `-e RESET_MFA=1` if the person also lost their authenticator and recovery codes. All of their sessions end; the reset is recorded in the audit log.

## 8. Verify

Check:

- `https://admin.your-domain.example/login`
- `https://admin.your-domain.example/api/health`

## 9. Set up encrypted off-site backups

Follow [backup-and-restore.md](backup-and-restore.md): create the club's backup key on an officer's computer (never on the server), create a versioned, write-only object-storage bucket, add `.env.backup`, then schedule `scripts/ops/backup-postgres.sh` nightly. An officer runs `scripts/ops/restore-postgres.sh verify` weekly to prove the newest backup restores.

Also take a Hetzner server snapshot before any upgrade.

## 10. Schedule the daily jobs

- `dues:service` bills each active member's dues for the new month (so everyone who has not prepaid starts the month unpaid), refreshes "paid this month" and arrears, and posts contributions waiting for the ledger.
- `loans:service` marks loans delinquent from their schedules, charges late fees once they are switched on (Gate #1 A7), and posts anything waiting for the ledger.
- `ledger:compare` (migration step M5) compares the ledger with the old records after the other two have run, keeps the result (*Ledger → Nightly comparison*), and emails `LEDGER_ALERT_EMAIL` (or `SECURITY_ALERT_EMAIL`) on any difference. It does nothing until opening balances are posted.

Both are safe to run more than once a day. Run `dues:service` once by hand right after deploying, so every member's dues are billed from January 2026 (`DUES_TRACKING_START`).

```bash
crontab -e
# 20 6 * * * cd /path/to/mcfinancial && docker compose -f docker-compose.hetzner.yml exec -T app npm run dues:service >> /var/log/mc-dues.log 2>&1
# 30 6 * * * cd /path/to/mcfinancial && docker compose -f docker-compose.hetzner.yml exec -T app npm run loans:service >> /var/log/mc-loans.log 2>&1
# 45 6 * * * cd /path/to/mcfinancial && docker compose -f docker-compose.hetzner.yml exec -T app npm run ledger:compare >> /var/log/mc-ledger-compare.log 2>&1
```

A non-zero exit means a member or loan could not be processed; the log names it.

## 11. Record the bank balance

Loans are approved only within the lending capacity (Gate #1 A10), which needs the club's cash. Until opening balances are posted (M4), that is the bank balance the Treasurer records. **Without one, no loan can be approved.** Right after deploying, the Treasurer opens *Money → Treasury* and records the current balance from online banking, then records a new one at least monthly from the statement.

## Google Sheets recommendation

Use Google Sheets only for:

- member import
- monthly contribution import
- reporting export

Do not use Google Sheets as the primary database for:

- loans
- loan payments
- agreements
- balance calculations
