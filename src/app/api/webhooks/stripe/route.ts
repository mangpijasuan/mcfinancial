import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { processStripeEvent } from '@/modules/payments/stripe'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = req.headers.get('stripe-signature')
  if (!secret || !signature) {
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 400 })
  }

  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err: any) {
    return NextResponse.json({ error: `Signature verification failed: ${err?.message}` }, { status: 400 })
  }

  try {
    await processStripeEvent(event)
  } catch {
    // Stripe must retry a verified payment that did not reach the books.
    return NextResponse.json({ error: 'Payment recording failed; retry delivery.' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
