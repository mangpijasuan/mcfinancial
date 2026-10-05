import { NextRequest, NextResponse } from 'next/server'
import { hostConfig, hostDecision } from '@/lib/hosts'

// Content-Security-Policy with a fresh nonce per request (S-8), following
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
// Next.js reads the nonce from this header and attaches it to its own
// scripts; any other script — including one injected through a bug — is
// refused by the browser.
//
// Styles allow 'unsafe-inline': charts (recharts) and a few components use
// style attributes, which nonces cannot cover, and injected CSS cannot run
// code.
//
// With APP_HOST and ADMIN_HOST set, it also keeps members and staff on
// their own addresses (src/lib/hosts.ts). Authorisation still lives in the
// Data Access Layer (src/modules/auth), per the Next.js authentication guide.
export function proxy(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
  const { pathname, search } = request.nextUrl
  const decision = hostDecision(hostConfig(), host, pathname, search, proto)
  if (decision.kind === 'redirect') return NextResponse.redirect(decision.to, 307)
  if (decision.kind === 'refuse') {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Not found' }, { status: decision.status })
      : new NextResponse('Not found', { status: decision.status })
  }
  // API calls, and pages Next.js fetches ahead of a click, need no policy.
  const prefetch = request.headers.has('next-router-prefetch') || request.headers.get('purpose') === 'prefetch'
  if (pathname.startsWith('/api/') || prefetch) return NextResponse.next()

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'
  const behindHttps = request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:'

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(behindHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    // API routes: the address check only (they return JSON, no policy needed).
    '/api/:path*',
    // Pages, prefetches included, so every page request gets the address
    // check; static files need neither.
    '/((?!api|_next/static|_next/image|favicon.ico|icon.png|brand/).*)',
  ],
}
