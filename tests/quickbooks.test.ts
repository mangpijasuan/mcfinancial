import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseFixtures, createMember } from './helpers/factories'
import { TEST_IDS, signInAs, staffEmail } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { callRoute } from './helpers/routes'
import { QBO_TEST_ENV, fakeQuickBooks } from './helpers/fakeQuickBooks'
import { sendEmail } from '@/lib/email'
import { systemAuditContext } from '@/modules/audit'
import { decryptSecret } from '@/modules/auth/mfa'
import {
  QBO_STATE_COOKIE, QuickBooksError, authorizeUrl, connect, createAchInvoice, disconnect, listItems, newOAuthState,
  qboQuote, quickBooksConfig, quickBooksStatus, setItems, setQuickBooksFetch, syncAchPayments,
} from '@/modules/payments/quickbooks'

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: vi.fn(async () => ({ ok: true })),
}))

const REALM = '9130350000000001'
const ctx = systemAuditContext('treasurer@example.test')
let qbo: ReturnType<typeof fakeQuickBooks>
let started: Date

/** Audit entries written during this test (the audit log is append-only, never reset). */
const audits = (action: string) => prisma.auditLog.count({ where: { action, at: { gte: started } } })

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

/** Connected, with both products chosen: members can pay by bank. */
async function ready() {
  await connect({ code: 'code-1', realmId: REALM }, ctx)
  await setItems({ duesItemId: '1', loanItemId: '2' }, ctx)
}

async function achPayment(overrides: Record<string, unknown> = {}) {
  return prisma.portalPayment.create({
    data: { publicId: `PP-ACH-${Math.random().toString(36).slice(2, 8)}`, memberId: TEST_IDS.member, type: 'contribution', amount: 20, method: 'ach', ...overrides },
  })
}

/** A member's ACH payment with its QuickBooks invoice, as the checkout makes it. */
async function invoiced(overrides: Record<string, unknown> = {}) {
  const payment = await achPayment(overrides)
  const member = await prisma.member.findUniqueOrThrow({ where: { id: payment.memberId } })
  const invoice = await createAchInvoice(payment, member)
  return prisma.portalPayment.update({ where: { id: payment.id }, data: { qboInvoiceId: invoice.invoiceId, qboInvoiceLink: invoice.link } })
}

beforeEach(async () => {
  started = new Date()
  await resetDatabase()
  await createBaseFixtures()
  qbo = fakeQuickBooks()
  setQuickBooksFetch(qbo.fetch)
  setEnv({ ...QBO_TEST_ENV, QBO_ENVIRONMENT: undefined, QBO_AUTHORIZE_URL: undefined, PAYMENT_ALERT_EMAIL: 'treasurer@example.test', SUPPORT_EMAIL: undefined })
  vi.mocked(sendEmail).mockClear()
})
afterEach(() => {
  setQuickBooksFetch(null)
  setEnv(Object.fromEntries([...Object.keys(QBO_TEST_ENV), 'QBO_ENVIRONMENT', 'QBO_AUTHORIZE_URL', 'PAYMENT_ALERT_EMAIL', 'SECURITY_ALERT_EMAIL', 'SUPPORT_EMAIL'].map((k) => [k, undefined])))
  vi.restoreAllMocks()
})

describe('QuickBooks settings and sign-in', () => {
  it('is off until the Intuit app is set up, and points at Intuit by default', () => {
    expect(quickBooksConfig({})).toBeNull()
    expect(quickBooksConfig({ QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b' })).toBeNull()
    const sandbox = quickBooksConfig({ QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b', QBO_REDIRECT_URI: 'https://x/cb' })!
    expect(sandbox).toMatchObject({ environment: 'sandbox', apiBase: 'https://sandbox-quickbooks.api.intuit.com', tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer' })
    const live = quickBooksConfig({ QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b', QBO_REDIRECT_URI: 'https://x/cb', QBO_ENVIRONMENT: 'production' })!
    expect(live).toMatchObject({ environment: 'production', apiBase: 'https://quickbooks.api.intuit.com', authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2' })
    expect(live.revokeUrl).toBe('https://developer.api.intuit.com/v2/oauth2/tokens/revoke')
  })

  it('asks Intuit for accounting access only, with a fresh random state each time', () => {
    const state = newOAuthState()
    expect(state).toMatch(/^[\w-]{32}$/)
    expect(newOAuthState()).not.toBe(state)
    const url = new URL(authorizeUrl(state))
    expect(url.origin + url.pathname).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-test', response_type: 'code', scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: QBO_TEST_ENV.QBO_REDIRECT_URI, state,
    })
    setEnv({ QBO_CLIENT_ID: undefined })
    expect(() => authorizeUrl(state)).toThrow(/not set up/)
  })

  it('keeps the tokens encrypted, never in plain text', async () => {
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    const conn = await prisma.quickBooksConnection.findUniqueOrThrow({ where: { id: 'club' } })
    expect(conn).toMatchObject({ realmId: REALM, environment: 'sandbox', connectedBy: 'treasurer@example.test' })
    expect(conn.accessTokenEnc).not.toContain('at-')
    expect(decryptSecret(conn.accessTokenEnc)).toBe('at-1')
    expect(decryptSecret(conn.refreshTokenEnc)).toBe('rt-1')
    expect(conn.refreshTokenExpiresAt).not.toBeNull()
    expect(qbo.state.grants).toEqual(['authorization_code'])
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'quickbooks.connect', at: { gte: started } } })
    expect(JSON.stringify(audit)).not.toMatch(/at-1|rt-1/)
  })

  it('refuses a company it cannot identify, and reports Intuit refusing the sign-in', async () => {
    await expect(connect({ code: 'c', realmId: 'abc' }, ctx)).rejects.toThrow(/which company/)
    qbo.state.tokenStatus = 400
    qbo.state.tokenError = 'invalid_grant'
    await expect(connect({ code: 'c', realmId: REALM }, ctx)).rejects.toThrow('QuickBooks sign-in failed (invalid_grant). Connect QuickBooks again.')
    qbo.state.tokenError = undefined
    await expect(connect({ code: 'c', realmId: REALM }, ctx)).rejects.toThrow('QuickBooks sign-in failed. Connect QuickBooks again.')
    expect(await prisma.quickBooksConnection.count()).toBe(0)
    setEnv({ QBO_CLIENT_SECRET: undefined })
    await expect(connect({ code: 'c', realmId: REALM }, ctx)).rejects.toThrow(QuickBooksError)
  })

  it('keeps the products when the same company reconnects, and starts afresh for another', async () => {
    await ready()
    await createAchInvoice(await achPayment(), await prisma.member.findUniqueOrThrow({ where: { id: TEST_IDS.member } }))
    expect(await prisma.quickBooksCustomer.count()).toBe(1)
    qbo.state.omitRefreshExpiry = true
    await connect({ code: 'code-2', realmId: REALM }, ctx)
    expect((await quickBooksStatus()).ready).toBe(true)
    expect((await prisma.quickBooksConnection.findUniqueOrThrow({ where: { id: 'club' } })).refreshTokenExpiresAt).toBeNull()
    expect(await prisma.quickBooksCustomer.count()).toBe(1)

    await connect({ code: 'code-3', realmId: '9130350000000002' }, ctx)
    const status = await quickBooksStatus()
    expect(status).toMatchObject({ connected: true, ready: false, duesItem: null, loanItem: null, realmId: '9130350000000002' })
    expect(await prisma.quickBooksCustomer.count()).toBe(0)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'quickbooks.connect', at: { gte: started } }, orderBy: { id: 'desc' } })
    expect(audit.metadata).toMatchObject({ replacedRealmId: REALM })
  })

  it('disconnects: revokes at Intuit when it can, and deletes the tokens either way', async () => {
    await disconnect(ctx) // nothing connected: nothing to do
    await connect({ code: 'code-1', realmId: REALM }, { ...ctx, actorLabel: null })
    expect((await prisma.quickBooksConnection.findUniqueOrThrow({ where: { id: 'club' } })).connectedBy).toBe('staff')
    await disconnect(ctx)
    expect(qbo.state.revoked).toEqual(['rt-1'])
    expect(await prisma.quickBooksConnection.count()).toBe(0)

    await connect({ code: 'code-2', realmId: REALM }, ctx)
    qbo.state.revokeFails = true
    await disconnect(ctx)
    expect(await prisma.quickBooksConnection.count()).toBe(0)

    await connect({ code: 'code-3', realmId: REALM }, ctx)
    setEnv({ QBO_CLIENT_ID: undefined }) // the app settings were removed from the server
    await disconnect(ctx)
    expect(await prisma.quickBooksConnection.count()).toBe(0)
    expect(await audits('quickbooks.disconnect')).toBe(3)
  })
})

describe('QuickBooks API calls', () => {
  it('lists the products that can go on an invoice', async () => {
    await expect(listItems()).rejects.toThrow('QuickBooks is not connected.')
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    expect(await listItems()).toEqual([
      { id: '1', name: 'Monthly dues', type: 'Service' },
      { id: '2', name: 'Loan repayment', type: 'NonInventory' },
    ])
  })

  it('refreshes the access token when it is about to run out, and keeps the newest refresh token', async () => {
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    await prisma.quickBooksConnection.update({ where: { id: 'club' }, data: { accessTokenExpiresAt: new Date(Date.now() + 60_000) } })
    await listItems()
    expect(qbo.state.grants).toEqual(['authorization_code', 'refresh_token'])
    expect(decryptSecret((await prisma.quickBooksConnection.findUniqueOrThrow({ where: { id: 'club' } })).refreshTokenEnc)).toBe('rt-2')
  })

  it('refreshes once when QuickBooks refuses the token, then gives up', async () => {
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    qbo.state.refused.add('at-1')
    expect(await listItems()).toHaveLength(2)
    expect(qbo.state.grants).toEqual(['authorization_code', 'refresh_token'])
    qbo.state.refused.add('at-2').add('at-3')
    await expect(listItems()).rejects.toThrow('QuickBooks: HTTP 401')
  })

  it('reports QuickBooks errors in its own words', async () => {
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    qbo.state.failures.push({ match: /query/, status: 400, body: { Fault: { Error: [{ Message: 'Invalid query', Detail: 'bad column', code: '4000' }] } } })
    await expect(listItems()).rejects.toMatchObject({ message: 'QuickBooks: Invalid query (bad column)', status: 400, code: '4000' })
    qbo.state.failures.push({ match: /query/, status: 200, body: { Fault: { Error: [{ Message: 'Throttled' }] } } })
    await expect(listItems()).rejects.toThrow(/^QuickBooks: Throttled$/)
    qbo.state.failures.push({ match: /query/, status: 503 })
    await expect(listItems()).rejects.toThrow('QuickBooks: HTTP 503')
    qbo.state.failures.push({ match: /query/, status: 200, body: {} })
    expect(await listItems()).toEqual([])
  })

  it('talks to the real network unless a test replaces it', () => {
    setQuickBooksFetch(null)
    setQuickBooksFetch(qbo.fetch)
  })

  it('quotes text safely in QuickBooks queries', () => {
    expect(qboQuote("O'Brien (MC-1)")).toBe("'O\\'Brien (MC-1)'")
    expect(qboQuote('back\\slash')).toBe("'back\\\\slash'")
  })

  it('only accepts products that exist in QuickBooks', async () => {
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    await expect(setItems({ duesItemId: '1', loanItemId: '3' }, ctx)).rejects.toThrow('Choose products that exist in QuickBooks.')
    await expect(setItems({ duesItemId: '99', loanItemId: '2' }, ctx)).rejects.toThrow(QuickBooksError)
    await setItems({ duesItemId: '1', loanItemId: '2' }, ctx)
    expect(await quickBooksStatus()).toMatchObject({ ready: true, duesItem: { id: '1', name: 'Monthly dues' }, loanItem: { id: '2', name: 'Loan repayment' } })
    await prisma.quickBooksConnection.update({ where: { id: 'club' }, data: { duesItemName: null, loanItemName: null } })
    expect(await quickBooksStatus()).toMatchObject({ duesItem: { name: '1' }, loanItem: { name: '2' } })
    setEnv({ QBO_CLIENT_ID: undefined })
    expect(await quickBooksStatus()).toMatchObject({ configured: false, connected: true, ready: false })
  })
})

describe('ACH invoices', () => {
  it('makes out an invoice to the member, bank transfer only, and returns QuickBooks’ payment page', async () => {
    await expect(createAchInvoice(await achPayment(), { id: TEST_IDS.member, legalName: 'X', email: null })).rejects.toThrow('Paying by bank is not available yet.')
    await ready()
    await prisma.member.update({ where: { id: TEST_IDS.member }, data: { email: 'member@example.test' } })
    const payment = await invoiced()
    const invoice = qbo.state.invoices.get(payment.qboInvoiceId!)!
    expect(invoice).toMatchObject({ TotalAmt: 20, ItemRef: '1', BillEmail: 'member@example.test' })
    expect(payment.qboInvoiceLink).toBe(`https://connect.intuit.example/pay/${invoice.Id}`)
    const customer = qbo.state.customers[0]
    expect(customer.DisplayName).toMatch(new RegExp(`\\(${TEST_IDS.member}\\)$`))
    expect(customer.email).toBe('member@example.test')

    // The same member's next invoice uses the same customer.
    await invoiced()
    expect(qbo.state.customers).toHaveLength(1)
    expect(qbo.state.calls.filter((c) => c === 'POST /api/v3/company/' + REALM + '/customer')).toHaveLength(1)
  })

  it('uses the loan product for a loan repayment, and the club address when the member has no email', async () => {
    await ready()
    await prisma.member.update({ where: { id: TEST_IDS.member }, data: { email: null } })
    const loan = await invoiced({ type: 'loan_payment', loanId: 'L-1' })
    expect(qbo.state.invoices.get(loan.qboInvoiceId!)).toMatchObject({ ItemRef: '2', BillEmail: 'support@mcfinancial.local' })
    setEnv({ SUPPORT_EMAIL: 'club@example.test' })
    const dues = await invoiced()
    expect(qbo.state.invoices.get(dues.qboInvoiceId!)!.BillEmail).toBe('club@example.test')
    expect(qbo.state.customers[0].email).toBeUndefined()
  })

  it('adopts a QuickBooks customer that already has the member’s name, and makes a new one after a company change', async () => {
    await ready()
    const member = await prisma.member.findUniqueOrThrow({ where: { id: TEST_IDS.member } })
    qbo.state.customers.push({ Id: 'C-existing', DisplayName: `${member.legalName} (${member.id})` })
    await invoiced()
    expect(await prisma.quickBooksCustomer.findUniqueOrThrow({ where: { memberId: member.id } })).toMatchObject({ customerId: 'C-existing', realmId: REALM })

    await prisma.quickBooksCustomer.update({ where: { memberId: member.id }, data: { realmId: 'another' } })
    qbo.state.customers.length = 0
    await invoiced()
    expect((await prisma.quickBooksCustomer.findUniqueOrThrow({ where: { memberId: member.id } })).realmId).toBe(REALM)
  })

  it('stops on any other QuickBooks error, and on a duplicate it cannot find', async () => {
    await ready()
    qbo.state.failures.push({ match: /customer/, status: 400, body: { Fault: { Error: [{ Message: 'Business validation error', code: '6000' }] } } })
    await expect(invoiced()).rejects.toThrow('QuickBooks: Business validation error')
    qbo.state.failures.push({ match: /customer/, status: 400, body: { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } } })
    await expect(invoiced()).rejects.toThrow('QuickBooks: Duplicate Name Exists Error')
  })

  it('refuses an invoice without a secure payment page (QuickBooks Payments not taking ACH)', async () => {
    await ready()
    qbo.state.invoiceLink = () => undefined
    await expect(invoiced()).rejects.toThrow(/did not give a payment page/)
    qbo.state.invoiceLink = (id) => `http://insecure.example/${id}`
    await expect(invoiced()).rejects.toThrow(/did not give a payment page/)
    // Plain http on this machine only for a local stand-in, as in the browser tests.
    qbo.state.invoiceLink = (id) => `http://localhost:3399/pay/${id}`
    await expect(invoiced()).rejects.toThrow(/did not give a payment page/)
    setEnv({ QBO_API_BASE: 'http://localhost:3399/api' })
    expect((await invoiced()).qboInvoiceLink).toMatch(/^http:\/\/localhost:3399\/pay\//)
  })
})

describe('recording paid ACH invoices', () => {
  it('does nothing while QuickBooks is not connected', async () => {
    expect(await syncAchPayments()).toEqual({ checked: 0, completed: 0, failed: 0, review: 0 })
  })

  it('records a paid invoice once, on the day QuickBooks says it was paid', async () => {
    await ready()
    const payment = await invoiced()
    expect(await syncAchPayments()).toEqual({ checked: 1, completed: 0, failed: 0, review: 0 }) // not paid yet
    const qboPaymentId = qbo.pay(payment.qboInvoiceId!, '2026-10-08')
    expect(await syncAchPayments()).toMatchObject({ checked: 1, completed: 1 })
    expect(await syncAchPayments()).toMatchObject({ checked: 0, completed: 0 })

    const after = await prisma.portalPayment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(after).toMatchObject({ status: 'completed', qboPaymentId })
    const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: after.contributionId! } })
    expect(contribution).toMatchObject({ amount: 20, paymentMethod: 'Bank transfer (ACH)', source: 'QuickBooks' })
    expect(contribution.paymentDate.toISOString()).toBe('2026-10-08T12:00:00.000Z')
    expect(await audits('payment.ach.complete')).toBe(1)
  })

  it('uses the day it was found when QuickBooks gives no payment date', async () => {
    await ready()
    const now = new Date('2026-10-09T15:00:00Z')
    const a = await invoiced()
    qbo.pay(a.qboInvoiceId!) // a payment without a date
    const b = await invoiced()
    qbo.state.invoices.get(b.qboInvoiceId!)!.Balance = 0 // paid, but no payment linked
    expect(await syncAchPayments({ now })).toMatchObject({ completed: 2 })
    for (const p of await prisma.portalPayment.findMany({ where: { method: 'ach' }, include: { member: false } })) {
      const c = await prisma.contribution.findUniqueOrThrow({ where: { id: p.contributionId! } })
      expect(c.paymentDate.toISOString()).toBe(now.toISOString())
    }
  })

  it('checks one member’s payments at most once a minute from the payment page', async () => {
    await ready()
    const mine = await invoiced()
    await createMember('MC-OTHER')
    const theirs = await invoiced({ memberId: 'MC-OTHER' })
    const now = new Date()
    expect(await syncAchPayments({ memberId: TEST_IDS.member, staleAfterMs: 60_000, now })).toMatchObject({ checked: 1 })
    expect(await syncAchPayments({ memberId: TEST_IDS.member, staleAfterMs: 60_000, now })).toMatchObject({ checked: 0 })
    expect(await syncAchPayments({ memberId: TEST_IDS.member, staleAfterMs: 60_000, now: new Date(now.getTime() + 61_000) })).toMatchObject({ checked: 1 })
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: theirs.id } })).qboCheckedAt).toBeNull()
    expect(mine.id).not.toBe(theirs.id)
  })

  it('closes a payment whose invoice was deleted in QuickBooks', async () => {
    await ready()
    const deleted = await invoiced()
    qbo.state.invoices.get(deleted.qboInvoiceId!)!.deleted = true
    const gone = await invoiced()
    qbo.state.failures.push({ match: new RegExp(`invoice/${gone.qboInvoiceId}$`), status: 404 })
    expect(await syncAchPayments()).toMatchObject({ checked: 2, completed: 0, failed: 0 })
    for (const p of [deleted, gone]) {
      expect(await prisma.portalPayment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'failed', rejectionReason: 'The QuickBooks invoice was deleted.' })
    }
    expect(await audits('payment.ach.invoice_deleted')).toBe(2)
  })

  it('records nothing twice when the payment changes while QuickBooks is asked', async () => {
    await ready()
    const payment = await invoiced()
    qbo.state.invoices.get(payment.qboInvoiceId!)!.deleted = true
    qbo.state.beforeInvoiceRead = async () => { await prisma.portalPayment.update({ where: { id: payment.id }, data: { status: 'completed' } }) }
    await syncAchPayments()
    expect(await audits('payment.ach.invoice_deleted')).toBe(0)

    const other = await invoiced()
    qbo.state.invoices.get(other.qboInvoiceId!)!.TotalAmt = 25
    qbo.state.invoices.get(other.qboInvoiceId!)!.Balance = 0
    qbo.state.beforeInvoiceRead = async () => { await prisma.portalPayment.update({ where: { id: other.id }, data: { status: 'completed' } }) }
    await syncAchPayments({ memberId: TEST_IDS.member })
    expect(await audits('payment.ach.review_required')).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('holds an invoice paid for a different amount for the Treasurer, records nothing', async () => {
    await ready()
    const payment = await invoiced()
    const invoice = qbo.state.invoices.get(payment.qboInvoiceId!)!
    invoice.TotalAmt = 25
    invoice.Balance = 0
    await syncAchPayments()
    expect(await prisma.portalPayment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: 'failed' })
    expect(await prisma.contribution.count({ where: { source: 'QuickBooks' } })).toBe(0)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(await audits('payment.ach.review_required')).toBe(1)
  })

  it('counts a QuickBooks outage as “could not check” and tries again next time', async () => {
    await ready()
    const payment = await invoiced()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    qbo.state.failures.push({ match: /invoice\/\w+$/, status: 500, body: { Fault: { Error: [{ Message: 'Service unavailable' }] } } })
    expect(await syncAchPayments()).toMatchObject({ checked: 1, failed: 1 })
    expect(err).toHaveBeenCalled()
    const real = qbo.fetch
    setQuickBooksFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/invoice/')) throw 'connection reset'
      return real(input, init)
    }) as typeof fetch)
    expect(await syncAchPayments()).toMatchObject({ checked: 1, failed: 1 })
    expect(err).toHaveBeenLastCalledWith(`QuickBooks: could not check ${payment.publicId}:`, 'connection reset')
    setQuickBooksFetch(qbo.fetch)
    qbo.pay(payment.qboInvoiceId!)
    expect(await syncAchPayments()).toMatchObject({ completed: 1 })
  })

  it('flags a recorded payment QuickBooks shows unpaid again (a likely ACH return), once, and changes nothing', async () => {
    await ready()
    const returned = await invoiced()
    qbo.pay(returned.qboInvoiceId!)
    const deleted = await invoiced()
    qbo.pay(deleted.qboInvoiceId!)
    const fine = await invoiced()
    qbo.pay(fine.qboInvoiceId!)
    const flaky = await invoiced()
    qbo.pay(flaky.qboInvoiceId!)
    await syncAchPayments()
    expect(await prisma.contribution.count({ where: { source: 'QuickBooks' } })).toBe(4)

    qbo.state.invoices.get(returned.qboInvoiceId!)!.Balance = 20
    qbo.state.invoices.get(deleted.qboInvoiceId!)!.deleted = true
    qbo.state.failures.push({ match: new RegExp(`invoice/${flaky.qboInvoiceId}$`), status: 500 })
    expect(await syncAchPayments()).toMatchObject({ review: 2 })
    expect(await syncAchPayments()).toMatchObject({ review: 0 }) // flagged once
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(await prisma.portalPayment.count({ where: { qboReturnFlaggedAt: { not: null } } })).toBe(2)
    expect(await prisma.contribution.count({ where: { source: 'QuickBooks' } })).toBe(4) // nothing reversed

    // A one-member check from the payment page never runs the return watch.
    qbo.state.invoices.get(fine.qboInvoiceId!)!.Balance = 20
    expect(await syncAchPayments({ memberId: TEST_IDS.member })).toMatchObject({ review: 0 })
  })

  it('flags a return only once even when two checks overlap', async () => {
    await ready()
    const payment = await invoiced()
    qbo.pay(payment.qboInvoiceId!)
    await syncAchPayments()
    qbo.state.invoices.get(payment.qboInvoiceId!)!.Balance = 20
    qbo.state.beforeInvoiceRead = async () => { await prisma.portalPayment.update({ where: { id: payment.id }, data: { qboReturnFlaggedAt: new Date() } }) }
    expect(await syncAchPayments()).toMatchObject({ review: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends alerts to the payment address, or security, and survives an undelivered one', async () => {
    await ready()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mismatch = async () => {
      const p = await invoiced()
      const inv = qbo.state.invoices.get(p.qboInvoiceId!)!
      inv.TotalAmt = 1
      inv.Balance = 0
      await syncAchPayments()
    }
    setEnv({ PAYMENT_ALERT_EMAIL: undefined, SECURITY_ALERT_EMAIL: 'security@example.test' })
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: 'mail down' } as any)
    await mismatch()
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toBe('security@example.test')
    expect(err).toHaveBeenCalledWith('QuickBooks alert could not be delivered:', 'mail down')
    setEnv({ SECURITY_ALERT_EMAIL: undefined })
    await mismatch()
    expect(sendEmail).toHaveBeenCalledTimes(1) // no address: no email
  })
})

describe('QuickBooks routes', () => {
  it('lets only the Treasurer see and change the connection', async () => {
    signInAs('finance')
    expect((await callRoute('quickbooks', 'GET')).status).toBe(403)
    signInAs('treasurer')
    expect((await callRoute('quickbooks', 'GET')).json).toEqual({ status: { configured: true, connected: false, ready: false }, items: [] })
  })

  it('connects through Intuit with a state only this sign-in knows', async () => {
    signInAs('treasurer')
    const res = await callRoute('quickbooks/connect', 'GET')
    expect(res.status).toBe(307)

    const mod = await import('@/app/api/quickbooks/connect/route')
    const { NextRequest } = await import('next/server')
    const started = await mod.GET()
    const state = started.cookies.get(QBO_STATE_COOKIE)!.value
    expect(started.headers.get('location')).toContain(`state=${state}`)
    expect(started.cookies.get(QBO_STATE_COOKIE)).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/api/quickbooks/callback' })

    const callback = await import('@/app/api/quickbooks/callback/route')
    const back = async (query: string, cookie?: string) => {
      const req = new NextRequest(`https://admin.example.test/api/quickbooks/callback?${query}`, { headers: cookie ? { cookie: `${QBO_STATE_COOKIE}=${cookie}` } : {} })
      return (await callback.GET(req)).headers.get('location')
    }
    expect(await back(`code=c&state=${state}&realmId=${REALM}`)).toBe('https://admin.example.test/payments?quickbooks=expired') // no cookie
    expect(await back(`code=c&state=wrong-but-same-length-state-value!&realmId=${REALM}`, state)).toBe('https://admin.example.test/payments?quickbooks=expired')
    expect(await back(`code=c&state=short&realmId=${REALM}`, state)).toBe('https://admin.example.test/payments?quickbooks=expired')
    expect(await back(`error=access_denied&state=${state}`, state)).toBe('https://admin.example.test/payments?quickbooks=cancelled')
    expect(await back(`state=${state}`, state)).toBe('https://admin.example.test/payments?quickbooks=error')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    qbo.state.tokenStatus = 400
    expect(await back(`code=c&state=${state}&realmId=${REALM}`, state)).toBe('https://admin.example.test/payments?quickbooks=error')
    expect(err).toHaveBeenCalled()
    qbo.state.tokenStatus = 200
    expect(await back(`code=c&state=${state}&realmId=${REALM}`, state)).toBe('https://admin.example.test/payments?quickbooks=connected')
    expect((await prisma.quickBooksConnection.findUniqueOrThrow({ where: { id: 'club' } })).connectedBy).toBe(staffEmail('treasurer'))

    signInAs('finance')
    expect((await callRoute('quickbooks/connect', 'GET')).status).toBe(403)
    expect((await callRoute('quickbooks/callback', 'GET', { query: 'code=c' })).status).toBe(403)
    signInAs('treasurer')
    setEnv({ QBO_CLIENT_ID: undefined })
    expect((await callRoute('quickbooks/connect', 'GET')).status).toBe(409)
    expect((await callRoute('quickbooks/callback', 'GET', { query: 'code=c' })).status).toBe(409)
    // The cookie is not secure on a plain-http development address.
    setEnv({ QBO_CLIENT_ID: 'client-test', QBO_REDIRECT_URI: 'http://localhost:3000/api/quickbooks/callback' })
    expect((await mod.GET()).cookies.get(QBO_STATE_COOKIE)!.secure).toBe(false)
  })

  it('chooses products, checks now and disconnects', async () => {
    signInAs('treasurer')
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    const got = await callRoute('quickbooks', 'GET')
    expect(got.json.items).toHaveLength(2)
    expect((await callRoute('quickbooks', 'PATCH', { body: { duesItemId: '1' } })).status).toBe(400)
    expect((await callRoute('quickbooks', 'PATCH', { body: { duesItemId: '1', loanItemId: '3' } })).json.error).toBe('Choose products that exist in QuickBooks.')
    expect((await callRoute('quickbooks', 'PATCH', { body: { duesItemId: '1', loanItemId: '2' } })).json.status.ready).toBe(true)
    qbo.state.failures.push({ match: /query/, status: 503 })
    await expect(callRoute('quickbooks', 'PATCH', { body: { duesItemId: '1', loanItemId: '2' } })).resolves.toMatchObject({ status: 400 })
    // Anything but a QuickBooks answer (here the network) is a server error, not the Treasurer's.
    setQuickBooksFetch((async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)
    await expect(callRoute('quickbooks', 'PATCH', { body: { duesItemId: '1', loanItemId: '2' } })).rejects.toThrow('fetch failed')
    setQuickBooksFetch(qbo.fetch)

    qbo.state.failures.push({ match: /query/, status: 503 })
    expect((await callRoute('quickbooks', 'GET')).json).toMatchObject({ items: [], error: 'QuickBooks: HTTP 503' })

    expect((await callRoute('quickbooks/sync', 'POST')).json).toEqual({ checked: 0, completed: 0, failed: 0, review: 0 })
    expect((await callRoute('quickbooks', 'DELETE')).json.status.connected).toBe(false)
    signInAs('finance')
    for (const [route, method] of [['quickbooks', 'PATCH'], ['quickbooks', 'DELETE'], ['quickbooks/sync', 'POST']] as const) {
      expect((await callRoute(route, method, { body: {} })).status).toBe(403)
    }
  })

  it('reports a QuickBooks listing failure that is not an Error', async () => {
    signInAs('treasurer')
    await connect({ code: 'code-1', realmId: REALM }, ctx)
    setQuickBooksFetch((async () => { throw 'socket hang up' }) as unknown as typeof fetch)
    expect((await callRoute('quickbooks', 'GET')).json.error).toBe('QuickBooks did not answer.')
  })
})

describe('members paying by bank', () => {
  it('offers bank payments only when QuickBooks is ready, and sends the member to QuickBooks', async () => {
    signInAs('member')
    const offer = async () => (await callRoute('portal/payments', 'GET')).json.ach
    expect(await offer()).toBe(false)
    expect((await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'ach', amount: 20 } })).status).toBe(409)
    expect(await prisma.portalPayment.count()).toBe(0)

    await ready()
    expect(await offer()).toBe(true)
    const res = await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'ach', amount: 20 } })
    expect(res.status).toBe(201)
    const payment = await prisma.portalPayment.findFirstOrThrow({ where: { method: 'ach' } })
    expect(res.json.url).toBe(payment.qboInvoiceLink)
    expect(payment).toMatchObject({ status: 'pending', amount: 20 })
    expect(await audits('payment.ach.initiate')).toBe(1)

    // Paid on QuickBooks: the member sees it recorded when they come back.
    qbo.pay(payment.qboInvoiceId!)
    const list = await callRoute('portal/payments', 'GET')
    expect(list.json.payments[0]).toMatchObject({ method: 'ach', status: 'completed' })
  })

  it('tells the member when QuickBooks fails, and keeps the page working if the check fails', async () => {
    await ready()
    signInAs('member')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    qbo.state.failures.push({ match: /invoice$/, status: 500 })
    const res = await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'ach', amount: 20 } })
    expect(res.status).toBe(502)
    expect(res.json.error).toMatch(/not working right now/)
    expect(await prisma.portalPayment.findFirstOrThrow({ where: { method: 'ach' } })).toMatchObject({ status: 'failed', rejectionReason: 'QuickBooks: HTTP 500' })

    vi.spyOn(prisma.portalPayment, 'findMany').mockRejectedValueOnce(new Error('database blip'))
    expect((await callRoute('portal/payments', 'GET')).status).toBe(200)
    expect(err).toHaveBeenCalledWith('QuickBooks check failed:', 'database blip')
    vi.mocked(prisma.portalPayment.findMany).mockRestore()
    vi.spyOn(prisma.portalPayment, 'findMany').mockImplementationOnce((() => { throw 'odd' }) as any)
    expect((await callRoute('portal/payments', 'GET')).status).toBe(200)
    expect(err).toHaveBeenCalledWith('QuickBooks check failed:', 'odd')
  })
})
