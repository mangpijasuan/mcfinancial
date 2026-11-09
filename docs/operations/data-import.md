# Importing from a spreadsheet

Officers can bring records into the app from a spreadsheet saved as CSV, from Excel, Numbers or Google Sheets. **Administration → Bulk Upload** has every upload the signed-in person may use, each as a card with a **Download sample file** button:

| Upload | What it does | Permission |
|---|---|---|
| **Import contributions** | Record a batch of payments. Also at **Contributions → Import**. | `contributions.record`: Finance, the Treasurer, the administrators |
| **Reverse contributions** | Send mistaken contributions for reversal. **Each one waits for approval** (see below). | `contributions.reverse`: Finance, the Treasurer |
| **Import loan repayments** | Record a batch of loan repayments. | `loan_payments.record`: Finance, the Treasurer, the administrators |
| **Import members** | Add new members, or update existing members' contact details. Also at **Members → Import from spreadsheet**. | `members.create`: the Administrator, the Super Admin, the Club Officer |

![Bulk Upload: a card per upload, and the preview of a file of loan repayments](../ui/bulk-upload.png)

**New loans can't be uploaded.** Each new loan goes through approval, a signed agreement and the payout, one loan at a time. The 2021–2025 loans came in from the club's records (see Loan History).

The database stays the club's official record. An import changes it only through the same steps as typing the records in, one by one.

## How it works

![The preview: rows to add and update, a warning, and rows refused with the reason](../ui/import-preview.png)


1. **Choose the file.** The app checks every row and shows a **preview**: what would be added, what would change (field by field, old → new), and what is refused, with the reason. **Nothing is saved yet.**
2. **Fix and choose again.** If any row has an error, nothing can be imported. Fix the rows in the spreadsheet, save it as CSV again, and choose it again.
3. **Import.** The file is checked once more, then **all rows are saved in one go, or none**: a failure halfway leaves nothing behind. Each record is audited as if typed in, plus one audit entry for the import (`IMP-…`).

**The same file cannot be imported twice.** The app keeps a fingerprint (SHA-256) of every imported file, and refuses one it has seen. A file saved on Windows or a Mac counts as the same file.

**Warnings** don't stop an import, but are worth a look:
- a new member whose name is already in the app, or twice in the file;
- a contribution that looks already recorded (same member, date and amount), or appears twice in the file;
- a payment for an inactive member;
- a loan repayment that looks already recorded, or is more than a loan made before the loan engine still owes.

## Members

| Column | |
|---|---|
| **Member ID** | Empty for a **new member**: the app gives the next number, as when adding by hand. The member's ID for an **update**. |
| **Legal name** | Required for a new member. |
| **Joined** | Required for a new member: `YYYY-MM-DD` or `M/D/YYYY`. |
| Nickname, Phone, Email, Beneficiary | Optional. |

**What an import will and won't change:**
- **Contact details only.** An update changes nickname, phone, email and beneficiary.
- **Blank cells change nothing.** An import never erases a detail.
- **Some things are changed in the app only,** one member at a time, so they can't change by accident in a sheet: names, join dates and status. A name that differs from the app is shown as a warning.
- **Money is never imported.** A member's contributions, balances and loans follow from recorded payments.
- **Roles that can't edit members:** a role that can add members but not edit them (none today) can import new members only.

**Round trip:** a **Members** file downloaded from **Data Export** can be edited and imported back. Its other columns (totals, status and so on) are ignored, and the preview lists them.

## Contributions

| Column | |
|---|---|
| **Member ID** | Required. |
| **Paid on** | Required: `YYYY-MM-DD` or `M/D/YYYY`, not in the future. |
| **Amount** | Required, in dollars: `20`, `20.00`, `$1,200.50`. |
| Method | Optional, e.g. Zelle, Cash. |
| Kind | `dues` (the default) or `voluntary`. |
| Received by, Note | Optional. |

Each contribution is recorded exactly as one typed in on the Contributions page:
- it gets its receipt number;
- it pays the member's oldest unpaid month first;
- it is posted to the ledger.

Its source shows as **Import**. To correct one after importing, reverse it on the Contributions page, as with any other.

## Loan repayments

| Column | |
|---|---|
| **Loan ID** | Required: the loan's ID, as on the **Loans** page. |
| **Paid on** | Required: `YYYY-MM-DD` or `M/D/YYYY`, not in the future. |
| **Amount** | Required, in dollars. |
| Method, Received by, Note | Optional. |

Each repayment is recorded exactly as one typed in on the **Repayments** page:
- On a loan on the loan engine, it is split across fees, overdue and current installments, and the loan's schedule and balance follow.
- It posts to the ledger.
- The borrower's and co-signer's loan status are updated.

**What is refused:**
- **Loans that can't take a repayment:** a cancelled loan, a written-off one, a loan not yet paid out, or one already paid off.
- **Too much:** more than pays off a loan on the loan engine, counting the file's earlier rows for the same loan.

## Reversing contributions

| Column | |
|---|---|
| **Receipt** | Required: the receipt number (`RC-2026-000123`), or the `CON-` number of a contribution recorded before receipts existed. |
| **Reason** | Required: why it is being reversed. |

**Nothing is reversed by the upload.** Each row becomes a request in **Approvals**, exactly as when a reversal is proposed from the contribution. A second person (the Treasurer) approves each one, and only then is it reversed. A reversed contribution stays on record, marked reversed, and stops counting towards dues and totals; its ledger entry is reversed.

**What is refused:**
- **Already handled:** a contribution already reversed, or whose reversal is already waiting for approval.
- **Repeated:** the same contribution twice in the file.

## Limits

- **Size:** up to 1 MB and 2,000 rows per file. Split larger files.
- **Columns:** they are found by name in the first row, in any order. Other columns are ignored and listed in the preview. Each upload has a **sample file** to start from.
- **Formulas:** cells are read as text. The apostrophe the export adds in front of formula-looking text is removed on import.
