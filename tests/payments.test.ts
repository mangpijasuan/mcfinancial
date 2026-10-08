// Member payments: Zelle claims confirmed by an admin, Stripe checkout
// completed by the webhook. The money must be recorded exactly once.
import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TEST_IDS, signInAs } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures } from './helpers/factories'
import { callRoute } from './helpers/routes'

async function zelleClaim(body: Record<string, unknown>) {
  signInAs('member')
  const res = await callRoute('portal/payments/checkout', 'POST', { body: { method: 'zelle', ...body } })
  expect(res.status).toBe(201)
  return res.json.portalPayment as { id: string; status: string }
}

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
})

describe('Zelle claims', () => {
  it('records a contribution when an admin confirms', async () => {
    // A member who joined this month owes only this month's dues.
    await prisma.member.update({ where: { id: TEST_IDS.member }, data: { joinDate: new Date() } })
    const claim = await zelleClaim({ type: 'contribution', amount: 25, zelleReference: 'ZL-123' })
    expect(claim.status).toBe('pending')

    signInAs('admin')
    const res = await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })
    expect(res.status).toBe(200)
    expect(res.json.status).toBe('completed')

    const contributions = await prisma.contribution.findMany({ where: { memberId: TEST_IDS.member } })
    expect(contributions).toHaveLength(1)
    expect(contributions[0]).toMatchObject({ amount: 25, paymentMethod: 'Zelle', source: 'Zelle' })
    expect(res.json.contributionId).toBe(contributions[0].id)

    const member = await prisma.member.findUniqueOrThrow({ where: { id: TEST_IDS.member } })
    expect(member.overallContributions).toBe(25)
    expect(member.thisMonth).toBe('PAID')
  })

  it('reduces the loan balance for a loan payment', async () => {
    const claim = await zelleClaim({ type: 'loan_payment', amount: 100, loanId: 'LN-TEST-A' })
    signInAs('admin')
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(200)
    const loan = await prisma.loan.findUniqueOrThrow({ where: { loanId: 'LN-TEST-A' } })
    expect(loan.totalPaid).toBe(100)
    expect(loan.balanceRemaining).toBe(900)
  })

  it('refuses a loan payment larger than the balance', async () => {
    signInAs('member')
    const res = await callRoute('portal/payments/checkout', 'POST', {
      body: { type: 'loan_payment', method: 'zelle', amount: 1000.01, loanId: 'LN-TEST-A' },
    })
    expect(res.status).toBe(400)
  })

  it('cannot be confirmed twice', async () => {
    const claim = await zelleClaim({ type: 'contribution', amount: 25 })
    signInAs('admin')
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(200)
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(409)
    expect(await prisma.contribution.count()).toBe(1)
  })

  it('records the money once when two admins confirm at the same moment', async () => {
    const claim = await zelleClaim({ type: 'contribution', amount: 25 })
    signInAs('admin')
    const results = await Promise.all(
      Array.from({ length: 5 }, () => callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })),
    )
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409])
    expect(await prisma.contribution.count()).toBe(1)
  })

  it('cannot confirm a claim that was rejected', async () => {
    const claim = await zelleClaim({ type: 'contribution', amount: 25 })
    signInAs('admin')
    const rejected = await callRoute('payments/[id]/reject', 'POST', { params: { id: claim.id }, body: { reason: 'Not in bank' } })
    expect(rejected.status).toBe(200)
    expect(rejected.json).toMatchObject({ status: 'rejected', rejectionReason: 'Not in bank' })
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(409)
    expect(await prisma.contribution.count()).toBe(0)
  })
})

describe('Stripe checkout', () => {
  const WEBHOOK_SECRET = 'whsec_test_only'

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = ''
    process.env.STRIPE_WEBHOOK_SECRET = ''
  })

  it('fails clearly when Stripe is not configured', async () => {
    signInAs('member')
    const res = await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'stripe', amount: 25 } })
    expect(res.status).toBe(502)
    const [payment] = await prisma.portalPayment.findMany()
    expect(payment.status).toBe('failed')
  })

  it('rejects webhook calls without a valid signature', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    const res = await callRoute('webhooks/stripe', 'POST', {
      rawBody: JSON.stringify({ type: 'checkout.session.completed' }),
      headers: { 'stripe-signature': 't=1,v1=forged' },
    })
    expect(res.status).toBe(400)
  })

  it('records a completed checkout exactly once, however often Stripe retries', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    const pending = await prisma.portalPayment.create({
      data: { publicId: 'PP-TEST', memberId: TEST_IDS.member, type: 'contribution', amount: 25, method: 'stripe', stripeSessionId: 'cs_test_1' },
    })

    const payload = JSON.stringify({
      id: 'evt_test_1', created: Math.floor(Date.now() / 1000),
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', object: 'checkout.session', created: Math.floor(Date.now() / 1000), currency: 'usd', amount_total: 2500, payment_status: 'paid', payment_intent: 'pi_test_1', metadata: { portalPaymentId: pending.id } } },
    })
    const signature = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
    const deliver = () => callRoute('webhooks/stripe', 'POST', { rawBody: payload, headers: { 'stripe-signature': signature } })

    const results = await Promise.all([deliver(), deliver(), deliver()])
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect((await deliver()).status).toBe(200)

    expect(await prisma.contribution.count()).toBe(1)
    const done = await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })
    expect(done).toMatchObject({ status: 'completed', stripePaymentIntentId: 'pi_test_1' })
  })
})
