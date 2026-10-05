// Members and staff on separate addresses (D-17): which address serves
// which route, and what happens on the wrong one.
import { describe, expect, it } from 'vitest'
import { hostConfig, hostDecision, memberAppOrigin, routeSurface, signInFollowsRequestHost } from '@/lib/hosts'

const cfg = { app: 'app.mcfinancial.us', admin: 'admin.mcfinancial.us' }

describe('settings', () => {
  it('splits only with two different addresses', () => {
    expect(hostConfig({})).toBeNull()
    expect(hostConfig({ ADMIN_HOST: 'admin.mcfinancial.us' })).toBeNull()
    expect(hostConfig({ APP_HOST: 'x.example', ADMIN_HOST: 'X.example ' })).toBeNull()
    expect(hostConfig({ APP_HOST: ' App.McFinancial.us', ADMIN_HOST: 'admin.mcfinancial.us' })).toEqual(cfg)
  })

  it('sign-in follows the request address only when split', () => {
    const single: Record<string, string | undefined> = { NEXTAUTH_URL: 'https://admin.mcfinancial.us' }
    signInFollowsRequestHost(single)
    expect(single).toEqual({ NEXTAUTH_URL: 'https://admin.mcfinancial.us' })
    const split: Record<string, string | undefined> = { APP_HOST: cfg.app, ADMIN_HOST: cfg.admin, NEXTAUTH_URL: 'https://admin.mcfinancial.us' }
    signInFollowsRequestHost(split)
    expect(split).toEqual({ APP_HOST: cfg.app, ADMIN_HOST: cfg.admin, AUTH_TRUST_HOST: 'true' })
  })

  it('card checkout returns members to the member app', () => {
    expect(memberAppOrigin('http://localhost:3000/api/portal/payments/checkout', { APP_HOST: cfg.app, ADMIN_HOST: cfg.admin, NEXTAUTH_URL: 'https://admin.mcfinancial.us' })).toBe('https://app.mcfinancial.us')
    expect(memberAppOrigin('http://localhost:3000/x', { NEXTAUTH_URL: 'https://admin.mcfinancial.us' })).toBe('https://admin.mcfinancial.us')
    expect(memberAppOrigin('http://localhost:3000/x', {})).toBe('http://localhost:3000')
  })
})

describe('routes', () => {
  it('belong to the member app, the staff console, or both', () => {
    for (const p of ['/portal', '/portal/login', '/portal/receipts/RC-1', '/api/portal/me']) expect(routeSurface(p)).toBe('app')
    for (const p of ['/', '/login', '/dashboard', '/members/MC-0001', '/security/mfa', '/api/members', '/api/me/password', '/portalish']) expect(routeSurface(p)).toBe('admin')
    for (const p of ['/api/auth/session', '/api/auth', '/api/health', '/api/webhooks/stripe', '/api/agreements', '/api/agreements/AG-1/sign']) expect(routeSurface(p)).toBe('both')
  })
})

describe('requests', () => {
  it('pass unchanged on one address', () => {
    expect(hostDecision(null, 'anything.example', '/portal/login')).toEqual({ kind: 'pass' })
  })

  it('pass on the right address', () => {
    expect(hostDecision(cfg, 'app.mcfinancial.us', '/portal/dashboard')).toEqual({ kind: 'pass' })
    expect(hostDecision(cfg, 'ADMIN.mcfinancial.us:443', '/dashboard')).toEqual({ kind: 'pass' })
    expect(hostDecision(cfg, 'app.mcfinancial.us', '/api/auth/callback/member')).toEqual({ kind: 'pass' })
    expect(hostDecision(cfg, 'admin.mcfinancial.us', '/api/agreements')).toEqual({ kind: 'pass' })
  })

  it('move a page to the right address, keeping the path and query', () => {
    expect(hostDecision(cfg, 'admin.mcfinancial.us', '/portal/pay', '?status=success')).toEqual({ kind: 'redirect', to: 'https://app.mcfinancial.us/portal/pay?status=success' })
    expect(hostDecision(cfg, 'app.mcfinancial.us:3400', '/members/MC-0001', '', 'http')).toEqual({ kind: 'redirect', to: 'http://admin.mcfinancial.us:3400/members/MC-0001' })
  })

  it('send members on the bare address, or the old sign-in path, to theirs', () => {
    expect(hostDecision(cfg, 'app.mcfinancial.us', '/')).toEqual({ kind: 'redirect', to: 'https://app.mcfinancial.us/portal' })
    expect(hostDecision(cfg, 'app.mcfinancial.us', '/login')).toEqual({ kind: 'redirect', to: 'https://app.mcfinancial.us/portal/login' })
  })

  it('refuse an API call on the wrong address, and any unknown address', () => {
    expect(hostDecision(cfg, 'app.mcfinancial.us', '/api/members')).toEqual({ kind: 'refuse', status: 404 })
    expect(hostDecision(cfg, 'admin.mcfinancial.us', '/api/portal/me')).toEqual({ kind: 'refuse', status: 404 })
    expect(hostDecision(cfg, 'evil.example', '/login')).toEqual({ kind: 'refuse', status: 421 })
    expect(hostDecision(cfg, null, '/portal/login')).toEqual({ kind: 'refuse', status: 421 })
  })

  it('let the container health check through on any address', () => {
    expect(hostDecision(cfg, '127.0.0.1:3000', '/api/health')).toEqual({ kind: 'pass' })
  })
})
