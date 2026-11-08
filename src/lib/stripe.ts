import Stripe from 'stripe'

let client: Stripe | null = null

export function stripePaymentsReady(): boolean {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? ''
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? ''
  return /^sk_(test|live)_/.test(key) && webhook.startsWith('whsec_')
}

/** Throws if STRIPE_SECRET_KEY isn't configured — callers should catch and return a clear error. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY to enable card payments.')
  }
  if (!client) {
    client = new Stripe(key)
  }
  return client
}
