// ACH payments through QuickBooks Online (docs/operations/quickbooks.md).
//
// The club already takes ACH payments with QuickBooks Payments. A member who
// chooses "Bank (ACH)" in the portal gets a QuickBooks invoice and pays it on
// QuickBooks' own page: bank account numbers never reach this app. Paid
// invoices are found by polling (a job every few minutes, and whenever the
// member opens the payment page) and recorded once, through the same path as
// card payments. Nothing is ever reversed automatically: an invoice that
// becomes unpaid again (an ACH return) is held for the Treasurer.
import { randomBytes } from 'node:crypto'
import type { PortalPayment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendEmail, escapeHtml } from '@/lib/email'
import { fromLegacyDollars } from '@/lib/money'
import { decryptSecret, encryptSecret } from '@/modules/auth/mfa'
import { recordAudit, systemAuditContext, type AuditContext } from '@/modules/audit'
import { completePortalPayment } from './complete'

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'
/** Holds the sign-in's random state between Intuit's redirect out and back. */
export const QBO_STATE_COOKIE = 'mc_qbo_state'
const MINOR_VERSION = '75'
/** Refresh a little before the hour-long access token runs out. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000
/** How long a completed ACH payment is watched for a return. */
export const RETURN_WATCH_DAYS = 30

type Fetch = typeof fetch
let fetchImpl: Fetch = globalThis.fetch
/** Tests replace QuickBooks with a fake; nothing else calls this. */
export function setQuickBooksFetch(f: Fetch | null) { fetchImpl = f ?? globalThis.fetch }

export class QuickBooksError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message) }
}

export type QuickBooksConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  environment: 'sandbox' | 'production'
  authorizeUrl: string
  tokenUrl: string
  revokeUrl: string
  apiBase: string
}

/** The Intuit app's settings, or null while QuickBooks is not set up. */
export function quickBooksConfig(env: Record<string, string | undefined> = process.env): QuickBooksConfig | null {
  const clientId = env.QBO_CLIENT_ID?.trim()
  const clientSecret = env.QBO_CLIENT_SECRET?.trim()
  const redirectUri = env.QBO_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  const environment = env.QBO_ENVIRONMENT?.trim() === 'production' ? 'production' : 'sandbox'
  return {
    clientId, clientSecret, redirectUri, environment,
    // The defaults are Intuit's; the overrides exist for the browser tests' stand-in.
    authorizeUrl: env.QBO_AUTHORIZE_URL?.trim() || 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: env.QBO_TOKEN_URL?.trim() || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revokeUrl: env.QBO_REVOKE_URL?.trim() || 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
    apiBase: env.QBO_API_BASE?.trim()
      || (environment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'),
  }
}

function requireConfig(): QuickBooksConfig {
  const cfg = quickBooksConfig()
  if (!cfg) throw new QuickBooksError('QuickBooks is not set up on this server (QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI).')
  return cfg
}

/** A random value tying Intuit's answer to the sign-in that asked for it. */
export function newOAuthState(): string {
  return randomBytes(24).toString('base64url')
}

export function authorizeUrl(state: string, cfg = requireConfig()): string {
  const url = new URL(cfg.authorizeUrl)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', QBO_SCOPE)
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in?: number }

async function tokenRequest(cfg: QuickBooksConfig, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchImpl(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  })
  const body = await res.json().catch(() => null) as (TokenResponse & { error?: string }) | null
  if (!res.ok || !body?.access_token || !body.refresh_token) {
    throw new QuickBooksError(`QuickBooks sign-in failed${body?.error ? ` (${body.error})` : ''}. Connect QuickBooks again.`, res.status)
  }
  return body
}

function tokenFields(t: TokenResponse, now: number) {
  return {
    accessTokenEnc: encryptSecret(t.access_token),
    accessTokenExpiresAt: new Date(now + t.expires_in * 1000),
    refreshTokenEnc: encryptSecret(t.refresh_token),
    refreshTokenExpiresAt: t.x_refresh_token_expires_in ? new Date(now + t.x_refresh_token_expires_in * 1000) : null,
  }
}

/** Finishes the Treasurer's sign-in: exchanges Intuit's code for tokens and keeps them encrypted. */
export async function connect(input: { code: string; realmId: string }, ctx: AuditContext, now = Date.now()) {
  const cfg = requireConfig()
  if (!/^\d+$/.test(input.realmId)) throw new QuickBooksError('QuickBooks did not say which company was connected.')
  const tokens = await tokenRequest(cfg, { grant_type: 'authorization_code', code: input.code, redirect_uri: cfg.redirectUri })
  await prisma.$transaction(async (tx) => {
    const before = await tx.quickBooksConnection.findUnique({ where: { id: 'club' } })
    // Another company: its customers are not this one's.
    if (before && before.realmId !== input.realmId) await tx.quickBooksCustomer.deleteMany({})
    const data = { realmId: input.realmId, environment: cfg.environment, connectedBy: ctx.actorLabel ?? 'staff', connectedAt: new Date(now), ...tokenFields(tokens, now) }
    const sameCompany = before?.realmId === input.realmId
    await tx.quickBooksConnection.upsert({
      where: { id: 'club' },
      create: { id: 'club', ...data },
      // Reconnecting the same company keeps the chosen products.
      update: sameCompany ? data : { ...data, duesItemId: null, duesItemName: null, loanItemId: null, loanItemName: null },
    })
    await recordAudit(tx, ctx, {
      action: 'quickbooks.connect', entityType: 'quickbooks', entityId: input.realmId,
      metadata: { environment: cfg.environment, replacedRealmId: before && !sameCompany ? before.realmId : undefined },
    })
  })
}

export async function disconnect(ctx: AuditContext) {
  const cfg = quickBooksConfig()
  const conn = await prisma.quickBooksConnection.findUnique({ where: { id: 'club' } })
  if (!conn) return
  if (cfg) {
    // Best effort: the tokens are deleted here whether or not Intuit answers.
    await fetchImpl(cfg.revokeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: JSON.stringify({ token: decryptSecret(conn.refreshTokenEnc) }),
    }).catch(() => undefined)
  }
  await prisma.$transaction(async (tx) => {
    await tx.quickBooksConnection.delete({ where: { id: 'club' } })
    await recordAudit(tx, ctx, { action: 'quickbooks.disconnect', entityType: 'quickbooks', entityId: conn.realmId })
  })
}

async function accessToken(cfg: QuickBooksConfig, now = Date.now()) {
  const conn = await prisma.quickBooksConnection.findUnique({ where: { id: 'club' } })
  if (!conn) throw new QuickBooksError('QuickBooks is not connected.')
  if (conn.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > now) return { token: decryptSecret(conn.accessTokenEnc), realmId: conn.realmId }
  return refresh(cfg, conn.realmId, now)
}

async function refresh(cfg: QuickBooksConfig, realmId: string, now = Date.now()) {
  const conn = await prisma.quickBooksConnection.findUniqueOrThrow({ where: { id: 'club' } })
  const tokens = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: decryptSecret(conn.refreshTokenEnc) })
  // Intuit may issue a new refresh token: always keep the latest.
  await prisma.quickBooksConnection.update({ where: { id: 'club' }, data: tokenFields(tokens, now) })
  return { token: tokens.access_token, realmId }
}

type Fault = { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } }

/** One call to the QuickBooks Accounting API, refreshing the token once if it was refused. */
async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
  const cfg = requireConfig()
  let { token, realmId } = await accessToken(cfg)
  for (let attempt = 0; ; attempt++) {
    const url = new URL(`${cfg.apiBase}/v3/company/${realmId}/${path}`)
    url.searchParams.set('minorversion', MINOR_VERSION)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const res = await fetchImpl(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401 && attempt === 0) {
      ({ token, realmId } = await refresh(cfg, realmId))
      continue
    }
    const json = await res.json().catch(() => null) as (T & Fault) | null
    if (!res.ok || !json || json.Fault) {
      const err = json?.Fault?.Error?.[0]
      throw new QuickBooksError(`QuickBooks: ${err?.Message ?? `HTTP ${res.status}`}${err?.Detail ? ` (${err.Detail})` : ''}`, res.status, err?.code)
    }
    return json
  }
}

/** QuickBooks query strings quote with single quotes, escaped by a backslash. */
export function qboQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function query<T>(statement: string): Promise<T[]> {
  const res = await api<{ QueryResponse: Record<string, T[] | number | undefined> }>('GET', 'query', undefined, { query: statement })
  const rows = Object.values(res.QueryResponse ?? {}).find(Array.isArray)
  return (rows as T[] | undefined) ?? []
}

export type QboItem = { id: string; name: string; type: string }

/** Products and services the Treasurer can pick for dues and loan repayments. */
export async function listItems(): Promise<QboItem[]> {
  const items = await query<{ Id: string; Name: string; Type: string }>("select Id, Name, Type from Item where Active = true maxresults 500")
  return items.filter((i) => i.Type === 'Service' || i.Type === 'NonInventory').map((i) => ({ id: i.Id, name: i.Name, type: i.Type }))
}

export async function setItems(input: { duesItemId: string; loanItemId: string }, ctx: AuditContext) {
  const items = await listItems()
  const dues = items.find((i) => i.id === input.duesItemId)
  const loan = items.find((i) => i.id === input.loanItemId)
  if (!dues || !loan) throw new QuickBooksError('Choose products that exist in QuickBooks.')
  await prisma.$transaction(async (tx) => {
    const after = await tx.quickBooksConnection.update({
      where: { id: 'club' },
      data: { duesItemId: dues.id, duesItemName: dues.name, loanItemId: loan.id, loanItemName: loan.name },
    })
    await recordAudit(tx, ctx, {
      action: 'quickbooks.items', entityType: 'quickbooks', entityId: after.realmId,
      metadata: { dues: dues.name, loan: loan.name },
    })
  })
}

export type QuickBooksStatus = {
  configured: boolean
  connected: boolean
  ready: boolean
  environment?: string
  realmId?: string
  connectedAt?: Date
  connectedBy?: string
  duesItem?: { id: string; name: string } | null
  loanItem?: { id: string; name: string } | null
}

/** Whether members can pay by ACH: set up, connected, and both products chosen. */
export async function quickBooksStatus(): Promise<QuickBooksStatus> {
  const configured = quickBooksConfig() !== null
  const conn = await prisma.quickBooksConnection.findUnique({ where: { id: 'club' } })
  if (!conn) return { configured, connected: false, ready: false }
  const duesItem = conn.duesItemId ? { id: conn.duesItemId, name: conn.duesItemName ?? conn.duesItemId } : null
  const loanItem = conn.loanItemId ? { id: conn.loanItemId, name: conn.loanItemName ?? conn.loanItemId } : null
  return {
    configured, connected: true, ready: configured && duesItem !== null && loanItem !== null,
    environment: conn.environment, realmId: conn.realmId, connectedAt: conn.connectedAt, connectedBy: conn.connectedBy, duesItem, loanItem,
  }
}

type Member = { id: string; legalName: string; email: string | null }

/** The member's QuickBooks customer, created the first time they pay by ACH. */
async function customerFor(member: Member, realmId: string): Promise<string> {
  const known = await prisma.quickBooksCustomer.findUnique({ where: { memberId: member.id } })
  if (known && known.realmId === realmId) return known.customerId
  // The member ID keeps two members with the same name apart.
  const displayName = `${member.legalName} (${member.id})`.slice(0, 100)
  let customerId: string
  try {
    const created = await api<{ Customer: { Id: string } }>('POST', 'customer', {
      DisplayName: displayName,
      ...(member.email ? { PrimaryEmailAddr: { Address: member.email } } : {}),
    })
    customerId = created.Customer.Id
  } catch (err) {
    // Already in QuickBooks (code 6240, "Duplicate Name Exists"): use that customer.
    if (!(err instanceof QuickBooksError) || err.code !== '6240') throw err
    const [existing] = await query<{ Id: string }>(`select Id from Customer where DisplayName = ${qboQuote(displayName)}`)
    if (!existing) throw err
    customerId = existing.Id
  }
  await prisma.quickBooksCustomer.upsert({
    where: { memberId: member.id },
    create: { memberId: member.id, realmId, customerId },
    update: { realmId, customerId },
  })
  return customerId
}

type QboInvoice = {
  Id: string
  TotalAmt: number
  Balance: number
  InvoiceLink?: string
  LinkedTxn?: { TxnId: string; TxnType: string }[]
}

/**
 * Makes out a QuickBooks invoice for an ACH portal payment and returns the
 * QuickBooks page where the member pays it. Card payments are switched off
 * on the invoice: card payments go through Stripe.
 */
export async function createAchInvoice(payment: PortalPayment, member: Member): Promise<{ invoiceId: string; link: string }> {
  const status = await quickBooksStatus()
  if (!status.ready) throw new QuickBooksError('Paying by bank is not available yet.')
  const conn = await prisma.quickBooksConnection.findUniqueOrThrow({ where: { id: 'club' } })
  const customerId = await customerFor(member, conn.realmId)
  const item = payment.type === 'contribution' ? status.duesItem! : status.loanItem!
  const description = payment.type === 'contribution' ? 'Monthly contribution' : `Loan repayment (${payment.loanId})`
  const created = await api<{ Invoice: QboInvoice }>('POST', 'invoice', {
    CustomerRef: { value: customerId },
    // QuickBooks shows the pay link only for an invoice with an email address.
    BillEmail: { Address: member.email || process.env.SUPPORT_EMAIL || 'support@mcfinancial.local' },
    Line: [{
      Amount: payment.amount,
      Description: `${description} · ${payment.publicId}`,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { ItemRef: { value: item.id }, Qty: 1, UnitPrice: payment.amount },
    }],
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: false,
    PrivateNote: `Member portal payment ${payment.publicId} (${payment.memberId})`,
  })
  const invoice = await api<{ Invoice: QboInvoice }>('GET', `invoice/${created.Invoice.Id}`, undefined, { include: 'invoiceLink' })
  const link = invoice.Invoice.InvoiceLink
  // QuickBooks' pages are always https. Plain http is accepted only from a
  // stand-in on this machine (the browser tests), never from QuickBooks.
  const local = requireConfig().apiBase.startsWith('http://localhost:') && link?.startsWith('http://localhost:')
  if (!link || !(link.startsWith('https://') || local)) {
    throw new QuickBooksError('QuickBooks did not give a payment page for the invoice. Check that QuickBooks Payments takes bank transfers (ACH).')
  }
  return { invoiceId: created.Invoice.Id, link }
}

function qboDate(date: string | undefined, fallback: Date): Date {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : fallback
}

async function alertTreasurer(subject: string, html: string) {
  const to = process.env.PAYMENT_ALERT_EMAIL || process.env.SECURITY_ALERT_EMAIL
  if (!to) return
  const sent = await sendEmail(to, `MCFinancial: ${subject}`, html)
  if (!sent.ok) console.error('QuickBooks alert could not be delivered:', sent.error)
}

export type SyncResult = { checked: number; completed: number; failed: number; review: number }

/**
 * Looks at QuickBooks for the pending ACH payments (one member's, or all)
 * and records those whose invoice is paid in full. Also watches recent
 * completed ones for a return. `staleAfterMs` skips payments checked more
 * recently than that, so a page view cannot hammer QuickBooks.
 */
export async function syncAchPayments(opts: { memberId?: string; staleAfterMs?: number; now?: Date } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  const result: SyncResult = { checked: 0, completed: 0, failed: 0, review: 0 }
  if (!(await quickBooksStatus()).connected) return result
  const fresh = opts.staleAfterMs ? new Date(now.getTime() - opts.staleAfterMs) : null
  const pending = await prisma.portalPayment.findMany({
    where: {
      method: 'ach', status: 'pending', qboInvoiceId: { not: null },
      ...(opts.memberId ? { memberId: opts.memberId } : {}),
      ...(fresh ? { OR: [{ qboCheckedAt: null }, { qboCheckedAt: { lt: fresh } }] } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  for (const payment of pending) {
    result.checked++
    try {
      if (await checkPending(payment, now)) result.completed++
    } catch (err) {
      result.failed++
      console.error(`QuickBooks: could not check ${payment.publicId}:`, err instanceof Error ? err.message : err)
    }
  }
  if (!opts.memberId) result.review = await watchReturns(now)
  return result
}

async function checkPending(payment: PortalPayment, now: Date): Promise<boolean> {
  await prisma.portalPayment.update({ where: { id: payment.id }, data: { qboCheckedAt: now } })
  let invoice: QboInvoice
  try {
    invoice = (await api<{ Invoice: QboInvoice }>('GET', `invoice/${payment.qboInvoiceId}`)).Invoice
  } catch (err) {
    // Deleted or voided in QuickBooks: nothing will ever be paid on it.
    if (err instanceof QuickBooksError && (err.status === 404 || err.code === '610')) {
      const closed = await prisma.portalPayment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'failed', rejectionReason: 'The QuickBooks invoice was deleted.' },
      })
      if (closed.count) {
        await recordAudit(prisma, systemAuditContext('quickbooks-sync'), {
          action: 'payment.ach.invoice_deleted', entityType: 'portal_payment', entityId: payment.publicId,
          metadata: { qboInvoiceId: payment.qboInvoiceId },
        })
      }
      return false
    }
    throw err
  }
  if (invoice.Balance > 0) return false
  // Paid in full, and for the amount the member chose: anything else waits for the Treasurer.
  if (fromLegacyDollars(invoice.TotalAmt) !== fromLegacyDollars(payment.amount)) {
    const held = await prisma.portalPayment.updateMany({
      where: { id: payment.id, status: 'pending' },
      data: { status: 'failed', rejectionReason: `The QuickBooks invoice total (${invoice.TotalAmt}) does not match the payment. Reconcile it by hand.` },
    })
    if (held.count) {
      await recordAudit(prisma, systemAuditContext('quickbooks-sync'), {
        action: 'payment.ach.review_required', entityType: 'portal_payment', entityId: payment.publicId,
        metadata: { qboInvoiceId: invoice.Id, invoiceTotal: invoice.TotalAmt, amount: payment.amount },
      })
      await alertTreasurer('ACH payment needs attention', `<p>${escapeHtml(payment.publicId)}: the QuickBooks invoice ${escapeHtml(invoice.Id)} total does not match the payment. Nothing was recorded.</p>`)
    }
    return false
  }
  const paymentTxn = invoice.LinkedTxn?.find((t) => t.TxnType === 'Payment')
  let paidOn = now
  if (paymentTxn) {
    const qboPayment = await api<{ Payment: { TxnDate?: string } }>('GET', `payment/${paymentTxn.TxnId}`)
    paidOn = qboDate(qboPayment.Payment.TxnDate, now)
  }
  return completePortalPayment(payment, {
    actor: 'quickbooks-sync',
    action: 'payment.ach.complete',
    failedAction: 'payment.ach.record_failed',
    details: {
      paymentDate: paidOn,
      paymentMethod: 'Bank transfer (ACH)',
      comments: `QuickBooks invoice ${invoice.Id}${paymentTxn ? `, payment ${paymentTxn.TxnId}` : ''}`,
      source: 'QuickBooks',
    },
    references: { qboPaymentId: paymentTxn?.TxnId ?? null },
    metadata: { qboInvoiceId: invoice.Id, qboPaymentId: paymentTxn?.TxnId },
  })
}

/** A recorded ACH payment whose invoice is unpaid again was returned by the bank: hold it for the Treasurer. */
async function watchReturns(now: Date): Promise<number> {
  const since = new Date(now.getTime() - RETURN_WATCH_DAYS * 24 * 60 * 60 * 1000)
  const recent = await prisma.portalPayment.findMany({
    where: { method: 'ach', status: 'completed', reviewedAt: { gte: since }, qboReturnFlaggedAt: null },
    take: 200,
  })
  let review = 0
  for (const payment of recent) {
    try {
      const { Invoice } = await api<{ Invoice: QboInvoice }>('GET', `invoice/${payment.qboInvoiceId}`)
      if (Invoice.Balance <= 0) continue
    } catch (err) {
      // A deleted invoice was not paid either; anything else is retried next time.
      if (!(err instanceof QuickBooksError && (err.status === 404 || err.code === '610'))) continue
    }
    // The books are not changed: the Treasurer reverses the contribution or repayment after checking the bank.
    const marked = await prisma.portalPayment.updateMany({
      where: { id: payment.id, qboReturnFlaggedAt: null },
      data: { qboReturnFlaggedAt: now },
    })
    if (marked.count) {
      review++
      await recordAudit(prisma, systemAuditContext('quickbooks-sync'), {
        action: 'payment.ach.review_required', entityType: 'portal_payment', entityId: payment.publicId,
        metadata: { qboInvoiceId: payment.qboInvoiceId, reason: 'invoice unpaid after recording' },
      })
      await alertTreasurer('ACH payment may have been returned', `<p>${escapeHtml(payment.publicId)}: QuickBooks shows invoice ${escapeHtml(String(payment.qboInvoiceId))} unpaid again after it was recorded. Check the bank; if the ACH was returned, reverse the entry in the app. Nothing was changed automatically.</p>`)
    }
  }
  return review
}
