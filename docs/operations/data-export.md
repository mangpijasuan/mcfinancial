# Data export: spreadsheets and the Google Sheets copy

The club's records stay in the app's database, PostgreSQL, which is the official record. To read them in a spreadsheet, there are two ways:

- **Download a spreadsheet:** **Administration → Data Export** downloads any table as a CSV file. It opens in Excel, Numbers or Google Sheets.
- **The Google Sheets copy:** one Google Sheet with every table, refreshed each night and on demand. It is **read-only**: its tabs are locked, and nothing typed into it reaches the app.

Both include members' personal details (phone, email, beneficiary). Only the Treasurer, the Auditor and the Super Admin can use them (permission `data.export`). Every download and every copy is recorded in the audit log.

![The Data Export page](../ui/data-export.png)

## The tables

| Tab / file | What it holds |
|---|---|
| Members | Contact details, status, join date, contributions before and since 2026 and in total, months active, loan eligibility |
| Contributions | Every contribution: receipt, member, date, amount, method, the months it covers, reversals |
| Loans | Borrower, co-signer, amount, term, monthly payment, paid, balance, status, next due, overdue |
| Loan repayments | Every repayment |
| Older loans (2021–2025) | The earlier records, with the balances the Treasurer confirmed |
| Withdrawals | Every withdrawal of member capital |
| Ledger | Every ledger line: date, entry, account, debit, credit |

**Format:**
- **Figures:** they are the ones the app shows. Amounts are in dollars and cents, as numbers you can add up; dates are YYYY-MM-DD.
- **Formulas can't be smuggled in.** In the CSV files, any text that begins like a formula (`=`, `+`, `-`, `@`) starts with an apostrophe, so it shows as text and never runs. The Google Sheet stores every value exactly as typed, for the same reason.

## Setting up the Google Sheets copy

It takes about fifteen minutes in the club's Google account.

### 1. A service account

The service account is a "robot" Google account that the app signs in as. It can reach only what is shared with it.

1. Go to **console.cloud.google.com** and create a project, e.g. `millionaires-club`.
2. Open **APIs & Services → Library** and enable the **Google Sheets API**.
3. Open **IAM & Admin → Service Accounts → Create service account**, and name it e.g. `mc-export`. It needs no roles.
4. Open the new account, then **Keys → Add key → Create new key → JSON**. A file downloads.

That file is a password: **keep it private** and delete it once its values are on the server (step 3).

### 2. The spreadsheet

1. In the club's Google Drive, create a new, empty Google Sheet, e.g. *Millionaires Club records (read-only copy)*.
2. Click **Share** and add the service account's email, which ends in `iam.gserviceaccount.com`, as an **Editor**. Untick "Notify people".
3. Share it with the officers who should read it as **Viewer**, or as Editor if they need their own tabs. The app's tabs stay locked either way.
4. Copy the spreadsheet ID from its address: `docs.google.com/spreadsheets/d/`**`THIS-PART`**`/edit`.

### 3. The server's settings

Add these to `.env.production`. From the JSON key file, use `client_email` and `private_key`; keep the private key on one line, with its `\n` as they are.

```
GOOGLE_SHEETS_EXPORT_ID="the spreadsheet ID"
GOOGLE_SERVICE_ACCOUNT_EMAIL="mc-export@millionaires-club.iam.gserviceaccount.com"
GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Restart (`docker compose -f docker-compose.hetzner.yml up -d`), then open **Data Export** and click **Copy now**. The sheet gains these tabs:
- *About this copy*, with the time of the copy and the row counts;
- one tab per table.

The app adds its own tabs and locks only those. Any tabs the club adds are left alone.

### 4. Every night

```bash
crontab -e
# 15 2 * * * cd /path/to/mcfinancial && docker compose -f docker-compose.hetzner.yml exec -T app npm run sheets:export >> /var/log/mc-sheets.log 2>&1
```

If the copy fails, the job exits with an error and the log says why: for example, the sheet is no longer shared with the service account, or the key was replaced. The **Data Export** page shows when the last copy was made.

## Stopping it

- **Stop the copy:** remove the three `GOOGLE_*` settings and restart.
- **Cut off access:** remove the service account from the sheet's sharing, and delete its key in the Google Cloud console.

The sheet itself stays in the club's Drive until someone deletes it.
