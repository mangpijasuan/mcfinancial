// The audit log: append-only at the database level, secrets redacted,
// written in the same transaction as the change it records.
import Stripe from 'stripe'
import { beforeEach, describe, expect, it } from 'vitest'
import { TEST_IDS, signInAs } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { recordAudit, redact, systemAuditContext } from '@/modules/audit'

let marker: bigint

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  marker = await auditMarker()
})

describe('append-only enforcement', () => {
  it('rejects UPDATE, DELETE and TRUNCATE at the database', async () => {
    await recordAudit(prisma, systemAuditContext('test'), { action: 'test.write', entityType: 'test', entityId: '1' })
    const [entry] = await auditEntriesSince(marker)

    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/)
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(/append-only/)
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe('test.write')
  })
})

describe('redaction', () => {
  it('replaces secrets and keeps everything else', () => {
    expect(redact({ email: 'a@b.c', password: '$2a$10$hash', passwordChanged: true, nested: { portalPassword: 'x', apiToken: 't' }, n: BigInt(5), when: new Date('2026-01-02T00:00:00Z') }))
      .toEqual({ email: 'a@b.c', password: '[redacted]', passwordChanged: true, nested: { portalPassword: '[redacted]', apiToken: '[redacted]' }, n: '5', when: '2026-01-02T00:00:00.000Z' })
  })

  it('never stores a password hash when a staff password is reset', async () => {
    signInAs('super_admin')
    const res = await callRoute('staff/[id]', 'PATCH', { params: { id: TEST_IDS.admin }, body: { password: 'a brand new passphrase' } })
    expect(res.status).toBe(200)
    const [entry] = await auditEntriesSince(marker)
    expect(entry).toMatchObject({ action: 'staff.update', actorType: 'admin', actorId: TEST_IDS.superAdmin })
    expect(JSON.stringify([entry.before, entry.after, entry.metadata])).not.toMatch(/\$2[aby]\$/)
    expect(entry.before).not.toHaveProperty('password')
    expect((entry.metadata as any).passwordChanged).toBe(true)
  })
})

describe('entries are written with the change', () => {
  it('records who changed a member, and what changed', async () => {
    signInAs('admin')
    const res = await callRoute('members/[id]', 'PATCH', {
      params: { id: TEST_IDS.member },
      body: { phoneNo: '555-0100' },
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'vitest' },
    })
    expect(res.status).toBe(200)
    const entries = await auditEntriesSince(marker)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: 'member.update', entityType: 'member', entityId: TEST_IDS.member,
      actorType: 'admin', actorId: TEST_IDS.admin, actorLabel: `${TEST_IDS.admin}@example.test`,
      ip: '203.0.113.7', userAgent: 'vitest',
    })
    expect((entries[0].before as any).phoneNo).toBeNull()
    expect((entries[0].after as any).phoneNo).toBe('555-0100')
  })

  it('writes nothing when the request is refused', async () => {
    signInAs('member')
    await callRoute('members/[id]', 'PATCH', { params: { id: TEST_IDS.member }, body: { phoneNo: 'x' } })
    signInAs('admin')
    await callRoute('contributions', 'POST', { body: { memberId: TEST_IDS.member, amount: -5, paymentDate: '2026-09-01' } })
    expect(await auditEntriesSince(marker)).toHaveLength(0)
  })

  it('rolls back with the change it describes', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id: TEST_IDS.member }, data: { notes: 'temporary' } })
      await recordAudit(tx, systemAuditContext('test'), { action: 'member.update', entityType: 'member', entityId: TEST_IDS.member })
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(await auditEntriesSince(marker)).toHaveLength(0)
  })

  it('records the member, then the admin, for a Zelle payment', async () => {
    signInAs('member')
    const claim = await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'zelle', amount: 25 } })
    signInAs('admin')
    await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.json.portalPayment.id } })

    const entries = await auditEntriesSince(marker)
    expect(entries.map((e) => [e.action, e.actorType, e.actorId])).toEqual([
      ['payment.zelle.initiate', 'member', TEST_IDS.member],
      ['payment.zelle.confirm', 'admin', TEST_IDS.admin],
    ])
    expect((entries[1].before as any).status).toBe('pending')
    expect((entries[1].after as any).status).toBe('completed')
    expect((entries[1].metadata as any).contributionId).toMatch(/^CON-/)
  })

  it('records the Stripe webhook as the system, once', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_only'
    try {
      const pending = await prisma.portalPayment.create({
        data: { publicId: 'PP-AUDIT', memberId: TEST_IDS.member, type: 'contribution', amount: 25, method: 'stripe', stripeSessionId: 'cs_audit' },
      })
      const payload = JSON.stringify({
        id: 'evt_audit', object: 'event', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'cs_audit', object: 'checkout.session', currency: 'usd', amount_total: 2500, payment_status: 'paid', metadata: { portalPaymentId: pending.id } } },
      })
      const signature = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_only' })
      const deliver = () => callRoute('webhooks/stripe', 'POST', { rawBody: payload, headers: { 'stripe-signature': signature } })
      await Promise.all([deliver(), deliver()])

      const entries = await auditEntriesSince(marker)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ action: 'payment.stripe.complete', actorType: 'system', actorLabel: 'stripe-webhook', entityId: 'PP-AUDIT' })
      expect((entries[0].metadata as any).stripeEventId).toBe('evt_audit')
    } finally {
      process.env.STRIPE_SECRET_KEY = ''
      process.env.STRIPE_WEBHOOK_SECRET = ''
    }
  })
})

describe('audit viewer API', () => {
  it('pages newest first and filters by action', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(prisma, systemAuditContext('test'), { action: `test.page`, entityType: 'test', entityId: String(i) })
    }
    signInAs('super_admin')
    const first = await callRoute('audit', 'GET', { query: 'action=test.page&limit=3' })
    expect(first.status).toBe(200)
    expect(first.json.entries.map((e: any) => e.entityId)).toEqual(['4', '3', '2'])
    const second = await callRoute('audit', 'GET', { query: `action=test.page&limit=3&cursor=${first.json.nextCursor}` })
    expect(second.json.entries.map((e: any) => e.entityId)).toEqual(['1', '0'])
    expect(second.json.nextCursor).toBeNull()
  })
})

describe('agreement cancellation keeps the records (Gate #1 A3, A9)', () => {
  beforeEach(async () => {
    await prisma.loanAgreement.create({
      data: {
        agreementId: 'AGR-A', loanId: 'LN-TEST-A', borrowerId: TEST_IDS.member, borrowerName: 'A',
        loanAmount: 1000, monthlyPayment: 100, termMonths: 10,
        startDate: new Date('2026-02-10'), endDate: new Date('2026-11-15'),
      },
    })
    await prisma.member.update({ where: { id: TEST_IDS.member }, data: { activeAsBorrower: 1, currentLoanBalance: 1000 } })
  })

  it('marks the loan cancelled instead of deleting it', async () => {
    signInAs('admin')
    const res = await callRoute('agreements/[id]', 'PATCH', { params: { id: 'AGR-A' }, body: { action: 'cancel' } })
    expect(res.status).toBe(200)
    const loan = await prisma.loan.findUniqueOrThrow({ where: { loanId: 'LN-TEST-A' } })
    expect(loan).toMatchObject({ status: 'Cancelled', balanceRemaining: 0, loanAmount: 1000 })
    const member = await prisma.member.findUniqueOrThrow({ where: { id: TEST_IDS.member } })
    expect(member).toMatchObject({ activeAsBorrower: 0, currentLoanBalance: 0 })
    const [entry] = await auditEntriesSince(marker)
    expect(entry.action).toBe('agreement.cancel')
    expect((entry.metadata as any).loanBefore.status).toBe('Active')
  })

  it('refuses once a repayment exists, and changes nothing', async () => {
    signInAs('admin')
    await callRoute('loan-payments', 'POST', { body: { loanId: 'LN-TEST-A', amount: 100, paymentDate: '2026-03-10' } })
    const res = await callRoute('agreements/[id]', 'PATCH', { params: { id: 'AGR-A' }, body: { action: 'cancel' } })
    expect(res.status).toBe(409)
    expect(await prisma.loanPayment.count({ where: { loanId: 'LN-TEST-A' } })).toBe(1)
    expect((await prisma.loan.findUniqueOrThrow({ where: { loanId: 'LN-TEST-A' } })).status).toBe('Active')
  })

  it('does not let a signature be overwritten', async () => {
    signInAs('member')
    const first = await callRoute('agreements/[id]', 'PATCH', { params: { id: 'AGR-A' }, body: { signerType: 'borrower', signatureText: 'Member A' } })
    expect(first.status).toBe(200)
    const second = await callRoute('agreements/[id]', 'PATCH', { params: { id: 'AGR-A' }, body: { signerType: 'borrower', signatureText: 'Someone Else' } })
    expect(second.status).toBe(409)
    expect((await prisma.loanAgreement.findUniqueOrThrow({ where: { agreementId: 'AGR-A' } })).borrowerSignature).toBe('Member A')
  })
})
