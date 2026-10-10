# Bank payments (ACH) through QuickBooks Online

The club takes ACH payments with QuickBooks Payments. With this set up, a member who chooses **Bank (ACH)** on *Make a Payment* gets a QuickBooks invoice and pays it on QuickBooks' own page. The payment is then recorded in the app automatically: the contribution or loan repayment, its receipt, and its ledger entries.

Card (Stripe) and Zelle are unchanged, and members can still use them.

## How it works

1. **Invoice.** The member chooses *Bank (ACH)* and an amount. The app makes out a QuickBooks invoice to them:
   - the customer is created on first use, named "Full Name (MC-12345)";
   - the product is the one chosen for dues or for loan repayments;
   - bank transfer is the only payment option on the invoice.
2. **Paying.** The member is sent to the invoice's QuickBooks payment page and pays from their bank account there. **Bank account numbers never reach the app or the club's server.**
3. **Recording.** Every few minutes (the `quickbooks:sync` job), and whenever the member opens *Make a Payment*, the app asks QuickBooks about pending invoices.
   - An invoice **paid in full, for the amount the member chose**, is recorded once, on the payment date QuickBooks gives. It goes through the same steps as card payments, and the audit log notes it.
   - An invoice **paid for a different amount** is not recorded. It is held, and the Treasurer gets an email.
   - An invoice **deleted in QuickBooks** closes the payment as failed.
4. **Returns.** For 30 days after recording, the app keeps checking the invoice. If QuickBooks shows it unpaid again (for example, an ACH return):
   - the payment is flagged on *Online Payment Review*;
   - the Treasurer gets an email;
   - **the books are not changed automatically.** The Treasurer checks the bank and, if the transfer was returned, reverses the contribution or repayment in the app.

**In the ledger:** an ACH payment is received into account `1020`, *Zelle / bank transfer in transit*, like a Zelle payment. When QuickBooks deposits the money in the bank, Finance or the Treasurer records the **transfer to the bank** (*Reconciliation*) with the deposit's date and reference, as for Zelle.

**What QuickBooks receives:** the member's name, member ID and email address (as the invoice customer), and the amount. Nothing else.

## Setting it up

### 1. QuickBooks Payments

In QuickBooks Online, make sure **QuickBooks Payments** is active and accepts **bank transfers (ACH)**. Then create two products (*Sales → Products and services → New → Service*):

- **Monthly dues**
- **Loan repayment**

**Ask the accountant which account each should post to.** Member contributions are member capital and loan repayments reduce a receivable; they are not ordinary sales income. This is the same chart-of-accounts question as Gate #1 A13.

### 2. An Intuit developer app

1. Sign in at **developer.intuit.com** with the club's Intuit account, and create an app for **QuickBooks Online and Payments**, with the **Accounting** scope.
2. Under the app's settings, add the redirect URI. It must match exactly:
   `https://admin.mcfinancial.us/api/quickbooks/callback`
3. Copy the **Client ID** and **Client Secret**:
   - the **Development** keys work with a QuickBooks *sandbox* company, for trying it out;
   - the **Production** keys work with the club's real company. Intuit asks a short questionnaire about the app before issuing them.

### 3. The server's settings

Add these to `.env.production`, then restart with `docker compose -f docker-compose.hetzner.yml up -d`:

```
QBO_CLIENT_ID="..."
QBO_CLIENT_SECRET="..."
QBO_REDIRECT_URI="https://admin.mcfinancial.us/api/quickbooks/callback"
QBO_ENVIRONMENT="production"     # or "sandbox" with the Development keys
```

The Client Secret is a secret: keep it with the club's other secrets, never in the code or in chat.

### 4. Connect

1. A Treasurer (or Super Admin) opens **Online Payment Review** and clicks **Connect QuickBooks**.
2. They sign in to Intuit and choose the club's company. A QuickBooks admin must approve.
3. Back in the app, they choose the two products and click **Save products**.

The panel then says **Members can pay by bank**, and members see *Bank (ACH)* on *Make a Payment*.

The connection's tokens are stored encrypted with `MFA_ENCRYPTION_KEY`, like two-factor secrets. Changing that key means connecting QuickBooks again.

### 5. The job

Check for paid invoices every five minutes:

```bash
crontab -e
# */5 * * * * cd /path/to/mcfinancial && docker compose -f docker-compose.hetzner.yml exec -T app npm run quickbooks:sync >> /var/log/mc-quickbooks.log 2>&1
```

- **Exit code:** a non-zero exit means at least one invoice could not be checked; the next run tries again. Repeated failures usually mean the connection needs renewing.
- **Check now:** the panel's **Check QuickBooks now** runs the same check straight away.

## Keeping the connection alive

- **Tokens:** Intuit's access tokens last an hour and are renewed automatically. The renewal token lasts about 100 days and is renewed with each use, so a connection in regular use stays connected.
- **Expired connection:** if it expires or is revoked in QuickBooks, members simply stop seeing *Bank (ACH)* until a Treasurer clicks **Connect QuickBooks** again.
- **Disconnect:** this revokes the tokens at Intuit and deletes them here. Invoices and payments already in QuickBooks are not touched.

## Who can do what

| | Permission | Roles |
|---|---|---|
| Connect, choose products, check now, disconnect | `payments.manage_quickbooks` | Treasurer, Super Admin (and the transitional Club Officer) |
| See ACH payments on Online Payment Review | `payments.read` | as before |
| Pay by bank | a signed-in member | — |

## Tests

- `tests/quickbooks.test.ts` runs every path against a stand-in for Intuit's API (`tests/helpers/fakeQuickBooks.ts`). It covers sign-in, token renewal, customers, invoices, paid, partly paid, deleted and returned invoices, and access.
- The browser test `e2e/08-quickbooks-ach.spec.ts` connects, pays and records a payment through a local stand-in server (`e2e/fake-quickbooks.mjs`). The stand-in is the only place plain `http` payment pages are accepted.
