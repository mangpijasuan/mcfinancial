import { NextRequest, NextResponse } from 'next/server'
import { repaymentBlocker } from '@/lib/paymentActions'
import { prisma } from '@/lib/prisma'
import { requireMember } from '@/modules/auth'
import { parseDollars, toLegacyDollars, cents } from '@/lib/money'
import { nextPublicId } from '@/lib/publicIds'
import { getStripe } from '@/lib/stripe'
import { memberAppOrigin } from '@/lib/hosts'
import { badRequest, readJsonObject } from '@/lib/http'
import { auditContext, recordAudit } from '@/modules/audit'
import { withLoanBalances } from '@/modules/accounting/reads'

export async function POST(req: NextRequest) {
  const auth = await requireMember()
  if (auth.error) return auth.error
  const memberId = auth.principal.memberId

  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const type = body.type === 'loan_payment' ? 'loan_payment' : body.type === 'contribution' ? 'contribution' : null
  const method = body.method === 'zelle' ? 'zelle' : body.method === 'stripe' ? 'stripe' : null
  let amountCents: number
  try { amountCents = parseDollars(typeof body.amount === 'number' ? body.amount : String(body.amount ?? '')) }
  catch { return badRequest('Amount must be a dollar amount with at most two decimals.') }
  const amount = toLegacyDollars(cents(amountCents))

  if (!type) return NextResponse.json({ error: 'Invalid payment type.' }, { status: 400 })
  if (!method) return NextResponse.json({ error: 'Invalid payment method.' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
  }

  let loanId: string | null = null
  if (type === 'loan_payment') {
    loanId = String(body.loanId || '')
    if (!loanId) return NextResponse.json({ error: 'A loan must be selected.' }, { status: 400 })
    const loan = await prisma.loan.findUnique({ where: { loanId }, select: { loanId: true, borrowerId: true, status: true, balanceRemaining: true, lifecycle: true, principalCents: true } })
    if (!loan || loan.borrowerId !== memberId) {
      return NextResponse.json({ error: 'Loan not found.' }, { status: 404 })
    }
    if (loan.status !== 'Active' || repaymentBlocker(loan)) {
      return NextResponse.json({ error: repaymentBlocker(loan) ?? 'This loan is not active.' }, { status: 409 })
    }
    const [owed] = await withLoanBalances(prisma, [loan])
    if (amount > owed.balanceRemaining) {
      return NextResponse.json({ error: 'Amount exceeds the remaining loan balance.' }, { status: 400 })
    }
  }

  const ctx = auditContext(req, auth.principal)
  const portalPayment = await prisma.$transaction(async (tx) => {
    const created = await tx.portalPayment.create({
      data: {
      publicId: nextPublicId('PP'),
      memberId,
      type,
      loanId,
      amount,
      method,
      status: 'pending',
      zelleReference: method === 'zelle' ? (body.zelleReference ? String(body.zelleReference).slice(0, 500) : null) : null,
      },
    })
    await recordAudit(tx, ctx, {
      action: `payment.${method}.initiate`, entityType: 'portal_payment', entityId: created.publicId, after: created,
    })
    return created
  })

  if (method === 'zelle') {
    return NextResponse.json({ portalPayment }, { status: 201 })
  }

  // Stripe
  try {
    const stripe = getStripe()
    // Stripe sends the member back to the member app's address.
    const baseUrl = memberAppOrigin(req.url)
    const description = type === 'contribution' ? 'Monthly contribution' : `Loan payment (${loanId})`

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Millionaires Club - ${description}` },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: `${baseUrl}/portal/pay?status=success`,
      cancel_url: `${baseUrl}/portal/pay?status=cancelled`,
      client_reference_id: portalPayment.id,
      metadata: { portalPaymentId: portalPayment.id },
    })

    await prisma.portalPayment.update({
      where: { id: portalPayment.id },
      data: { stripeSessionId: session.id },
    })

    return NextResponse.json({ url: session.url }, { status: 201 })
  } catch (err: any) {
    await prisma.portalPayment.update({ where: { id: portalPayment.id }, data: { status: 'failed' } })
    return NextResponse.json({ error: err?.message || 'Could not start checkout.' }, { status: 502 })
  }
}
