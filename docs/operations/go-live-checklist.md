# Go-live checklist

What has to be true before real members use the app, in order. Each step links to the guide with the commands. Tick the boxes in a copy of this page as you go; the [pilot guide](pilot-guide.md) starts once everything above "Pilot" is done.

The server is a Hetzner CX23 in Nuremberg at `46.225.99.160`, named `mcfinancial`, with the `mcfinancial-web` firewall (TCP 22, 80, 443; UDP 443; ICMP). The app runs there with Docker, from a clone made with a read-only deploy key.

## 1. Server back on its normal system

As of 2026-11-08 the server was found in Hetzner's **Rescue System** (since 2026-10-21), so the app was offline.

- [ ] In the Hetzner console: the server → **Rescue** → **Disable rescue**, then **Power → Reset**.
- [ ] From an officer's computer (not the browser console, which types with a German keyboard), `ssh root@46.225.99.160` connects **without** a host-key warning. A warning after the reboot means stop and investigate: it is not the server's usual key.
- [ ] Find out who enabled rescue mode and why. If nobody knows, review the server before continuing: `last -20`, `journalctl --since 2026-10-20 --until 2026-10-22`, the users in `/etc/passwd`, `~/.ssh/authorized_keys`, and the Hetzner project's activity log.
- [ ] Never use **Rebuild** in the Hetzner console: it erases the disk.

## 2. Code up to date

- [ ] On the server: `cd ~/mcfinancial`, `git pull`, `docker compose -f docker-compose.hetzner.yml up -d --build`. If `git pull` refuses because of `package-lock.json`, run `git restore package-lock.json` first.
- [ ] `docker compose -f docker-compose.hetzner.yml exec app npx prisma migrate deploy` after any update that adds a migration (the pull request says so).
- [ ] `docker compose -f docker-compose.hetzner.yml exec app npx next --version` shows **16.4.5 or later** (the critical security fix of 2026-11-08).
- [ ] `docker compose -f docker-compose.hetzner.yml ps`: `app` is `healthy`.

## 3. Address and HTTPS

- [ ] Register **`mcfinancial.us`** (Gate #1 A16).
- [ ] DNS `A` records: `admin.mcfinancial.us` and `app.mcfinancial.us` → `46.225.99.160` (and `AAAA` → `2a01:4f8:1c1b:a9c4::2` if wanted). [Deploy guide §2](deploy-hetzner-postgres.md#2-point-your-domain).
- [ ] In `.env`: `DOMAIN=admin.mcfinancial.us`, `APP_DOMAIN=app.mcfinancial.us`. In `.env.production`: `NEXTAUTH_URL="https://admin.mcfinancial.us"`. Restart the stack; Caddy obtains the certificates.
- [ ] Both addresses open with a padlock. Until the domain exists, the trial `admin.` / `app.46-225-99-160.sslip.io` addresses work for a closed pilot.

## 4. Backups, and one restore

The Hetzner server backups copy the whole machine; the database also needs its own encrypted, off-site copy.

- [ ] Backup key created on an officer's computer, never on the server. [Backups §1](backup-and-restore.md#1-create-the-backup-key-on-an-officers-computer-not-the-server).
- [ ] Versioned, write-only storage bucket; `.env.backup` on the server. [Backups §2–3](backup-and-restore.md#2-create-the-storage-bucket).
- [ ] Nightly `scripts/ops/backup-postgres.sh` in the crontab, and the first backup present in the bucket.
- [ ] **One restore check passed** (`scripts/ops/restore-postgres.sh verify`, from the officer's computer). Then weekly. [Backups: weekly restore check](backup-and-restore.md#weekly-restore-check-an-officer-from-their-computer).
- [ ] A Hetzner snapshot taken before each upgrade.

## 5. People and permissions

- [ ] **Three officers named** (Gate #1 A4): who is Finance, who is Treasurer, who is the Board member. Write the names in the Gate #1 decision record.
- [ ] Each has a staff login (*Administration → Staff & Roles*) with the right role, and has set up two-factor authentication at first sign-in.
- [ ] The transitional *Club Officer* role is no longer used.
- [ ] `MAKER_CHECKER_ENFORCED="true"` in `.env.production`, then restart: payouts, reversals and the other checked actions now need a second person.
- [ ] `SECURITY_ALERT_EMAIL` and `LEDGER_ALERT_EMAIL` set to officers' addresses (they are used once email is set up).

## 6. The club's figures checked

Members will see these figures. The Treasurer checks them against the club's own records **before** any member signs in.

- [ ] Members: names, member numbers, join dates and status, against the club's list (*Members*).
- [ ] 2026 contributions, member by member: the **Monthly report** for each month so far (*Contributions → Monthly report*) against the club's monthly sheets. They must match to the cent.
- [ ] Yearly totals before 2026 (each member's *Year by year*) against the club's records.
- [ ] Loans: amount, monthly payment and balance for each live loan. Confirm the monthly payments of **L02, L04 and L05**, which were rounded to the cent when the data was loaded.
- [ ] The older loans still marked Active (*Loans → 2021–2025 records → Link older loans*): each linked to the right member, with the Treasurer's confirmed balance.
- [ ] Any difference is corrected in the app the normal way (a reversal and a new record), not in the database, so the audit log shows it.

## 7. Daily jobs and the bank balance

- [ ] `dues:service` and `loans:service` in the crontab. [Deploy guide §10](deploy-hetzner-postgres.md#10-schedule-the-daily-jobs).
- [ ] `dues:service` run once by hand right after deploying.
- [ ] The Treasurer records the current bank balance in *Money → Treasury*. Without one, no loan can be approved. Then at least monthly. [Deploy guide §11](deploy-hetzner-postgres.md#11-record-the-bank-balance).
- [ ] The Zelle details (`ZELLE_RECIPIENT_NAME`, `ZELLE_RECIPIENT_EMAIL`) and the QR code (`club/zelle-qr.png`) are the club's real ones.

## 8. Left off on purpose

These stay off for the pilot. Each has its own decision or guide.

| What | Stays | Until |
|---|---|---|
| Card payments (Stripe) | Keys empty | The club opens a Stripe account and decides who pays the fees (Q-11) |
| Bank payments (QuickBooks ACH) | Not connected | The Treasurer connects QuickBooks ([quickbooks.md](quickbooks.md)) |
| Email (Resend) | Key empty | A sending domain exists; password resets are done by an officer meanwhile |
| Late fees | `LATE_FEES_ENABLED="false"` | Counsel confirms the state's limits (Gate #1 A7) |
| Board-rule switches (`LOAN_*`, `WITHDRAWAL_*`, `FULL_EXIT_*`) | `"false"` | The board approves each rule |
| Ledger cutover | `LEDGER_READS="false"`, no opening balances | The accountant approves the chart of accounts (A13); then [migration M4–M6](../architecture/11-migration-roadmap-testing.md#1-migration-strategy) |
| Google Sheets copy | Not set up | Wanted ([data-export.md](data-export.md)) |
| Apple Wallet passes | Not configured | The Apple Developer certificate exists ([apple-wallet.md](apple-wallet.md)) |
| MCC, MC Points, UMI | Not built | Gate #1 Part B is decided |

## 9. Pilot

- [ ] Everything above is ticked, apart from the domain if the pilot uses the trial address.
- [ ] Follow the [pilot guide](pilot-guide.md).
