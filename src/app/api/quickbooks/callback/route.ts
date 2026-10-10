import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { auditContext } from '@/modules/audit'
import { QBO_STATE_COOKIE, connect, quickBooksConfig } from '@/modules/payments/quickbooks'

function sameState(a: string | undefined, b: string | null) {
  if (!a || !b || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// Intuit sends the Treasurer back here after they sign in. The answer is
// used only by the same signed-in Treasurer whose sign-in started it.
export async function GET(req: NextRequest) {
  const auth = await requirePermission('payments.manage_quickbooks')
  if (auth.error) return auth.error
  const cfg = quickBooksConfig()
  if (!cfg) return NextResponse.json({ error: 'QuickBooks is not set up on this server.' }, { status: 409 })
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/payments?quickbooks=${result}`, new URL(cfg.redirectUri).origin))
    res.cookies.set(QBO_STATE_COOKIE, '', { maxAge: 0, path: '/api/quickbooks/callback' })
    return res
  }

  const params = req.nextUrl.searchParams
  if (!sameState(req.cookies.get(QBO_STATE_COOKIE)?.value, params.get('state'))) return back('expired')
  if (params.get('error')) return back('cancelled')
  const code = params.get('code')
  const realmId = params.get('realmId')
  if (!code || !realmId) return back('error')
  try {
    await connect({ code, realmId }, auditContext(req, auth.principal))
  } catch (err) {
    console.error('QuickBooks connect failed:', err instanceof Error ? err.message : err)
    return back('error')
  }
  return back('connected')
}
