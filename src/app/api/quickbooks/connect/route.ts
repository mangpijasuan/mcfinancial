import { NextResponse } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { QBO_STATE_COOKIE, authorizeUrl, newOAuthState, quickBooksConfig } from '@/modules/payments/quickbooks'

// Sends the Treasurer to Intuit to sign in and choose the club's company.
// A random state, kept in a short-lived cookie, ties Intuit's answer to
// this sign-in, so nobody can connect their own company through a link.
export async function GET() {
  const auth = await requirePermission('payments.manage_quickbooks')
  if (auth.error) return auth.error
  const cfg = quickBooksConfig()
  if (!cfg) return NextResponse.json({ error: 'QuickBooks is not set up on this server.' }, { status: 409 })
  const state = newOAuthState()
  const res = NextResponse.redirect(authorizeUrl(state, cfg))
  res.cookies.set(QBO_STATE_COOKIE, state, {
    httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/api/quickbooks/callback',
    secure: new URL(cfg.redirectUri).protocol === 'https:',
  })
  return res
}
