// Members and staff on separate addresses (D-17, docs/architecture/13):
// app.<domain> serves the member portal, admin.<domain> the staff console.
// Each address keeps its own sign-in cookie, so a member session is never
// sent to the staff console. Set APP_HOST and ADMIN_HOST to switch it on;
// with either unset, one address serves everything (development, tests,
// and a server that has not split yet).
//
// The proxy (src/proxy.ts) applies hostDecision() to every page and API
// request. Authorisation still happens in the Data Access Layer.

export type Surface = 'app' | 'admin'
export type HostConfig = { app: string; admin: string }
export type HostDecision =
  | { kind: 'pass' }
  | { kind: 'redirect'; to: string }
  | { kind: 'refuse'; status: 404 | 421 }

export function hostConfig(env: Record<string, string | undefined> = process.env): HostConfig | null {
  const app = env.APP_HOST?.trim().toLowerCase()
  const admin = env.ADMIN_HOST?.trim().toLowerCase()
  return app && admin && app !== admin ? { app, admin } : null
}

// Routes both addresses serve: sign-in itself, the health check, payment
// webhooks, and loan agreements (staff prepare them, members sign them).
const SHARED = [/^\/api\/auth(\/|$)/, /^\/api\/health$/, /^\/api\/webhooks(\/|$)/, /^\/api\/agreements(\/|$)/]

/** Which address a path belongs to. */
export function routeSurface(pathname: string): Surface | 'both' {
  if (SHARED.some((r) => r.test(pathname))) return 'both'
  if (pathname === '/portal' || pathname.startsWith('/portal/') || pathname.startsWith('/api/portal/')) return 'app'
  return 'admin'
}

const hostname = (host: string) => host.replace(/:\d+$/, '').toLowerCase()

/**
 * What to do with a request for `pathname` that arrived on `host`.
 * A page on the wrong address moves to the right one; an API call on the
 * wrong address does not exist there. An address that is neither is
 * refused (421), except for the container's own health check.
 */
export function hostDecision(cfg: HostConfig | null, host: string | null, pathname: string, search = '', proto = 'https'): HostDecision {
  if (!cfg || pathname === '/api/health') return { kind: 'pass' }
  const name = hostname(host ?? '')
  const here: Surface | null = name === cfg.app ? 'app' : name === cfg.admin ? 'admin' : null
  if (!here) return { kind: 'refuse', status: 421 }
  // Members who type the bare address, or the old sign-in path, land on theirs.
  if (here === 'app' && (pathname === '/' || pathname === '/login')) {
    return { kind: 'redirect', to: `${proto}://${host}${pathname === '/' ? '/portal' : '/portal/login'}` }
  }
  const wants = routeSurface(pathname)
  if (wants === 'both' || wants === here) return { kind: 'pass' }
  if (pathname.startsWith('/api/')) return { kind: 'refuse', status: 404 }
  // Both addresses are served on the same port (none in production).
  const port = /:\d+$/.exec(host!)?.[0] ?? '' // host is one of ours by now
  return { kind: 'redirect', to: `${proto}://${cfg[wants]}${port}${pathname}${search}` }
}

/** The address members use, for links that leave the app (card checkout). */
export function memberAppOrigin(requestUrl: string, env: Record<string, string | undefined> = process.env): string {
  const cfg = hostConfig(env)
  if (cfg) return `https://${cfg.app}`
  return env.NEXTAUTH_URL || new URL(requestUrl).origin
}

/**
 * With two addresses, sign-in must use the address each request arrived
 * on. NextAuth sends every redirect to NEXTAUTH_URL when it is set, so in
 * that case it is set aside and NextAuth trusts the request's host, which
 * the proxy has already limited to APP_HOST and ADMIN_HOST.
 */
export function signInFollowsRequestHost(env: Record<string, string | undefined> = process.env) {
  if (!hostConfig(env)) return
  delete env.NEXTAUTH_URL
  env.AUTH_TRUST_HOST = 'true'
}
