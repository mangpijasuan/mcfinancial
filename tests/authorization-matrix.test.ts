// Authorisation matrix: every API route × method × caller → allowed or
// denied, derived from the permission catalogue (D-07). Callers are
// anonymous, a member, a staff account for every role, a staff account
// with no roles, and one that has not passed MFA.
//
// Two checks keep it honest:
// - coverage: a route cannot exist without an entry here;
// - source: each handler asks the DAL for exactly the permission listed,
//   so two permissions that happen to share holders cannot be confused.
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { ACTORS, type Actor, signInAs } from './helpers/actors'
import { resetDatabase } from './helpers/db'
import { createBaseFixtures } from './helpers/factories'
import { ROLES, isRoleKey, type Permission } from '@/modules/permissions'

type Requirement =
  | { public: true } // no session (health; the Stripe webhook authenticates by signature)
  | { member: true }
  | { perm: Permission }
  | { memberOr: Permission } // a member (ownership checked in the handler) or staff with the permission
  | { staffSession: true } // any staff session, even before MFA (enrolment)
  | { staff: true } // any staff with MFA verified (own account)

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
const perm = (p: Permission): Requirement => ({ perm: p })

const MATRIX: Record<string, Partial<Record<Method, Requirement>>> = {
  'agreements': { GET: { memberOr: 'agreements.read' } },
  'agreements/[id]': { GET: { memberOr: 'agreements.read' }, PATCH: { memberOr: 'agreements.read' } },
  'approvals': { GET: perm('approvals.view') },
  'approvals/[id]/approve': { POST: perm('approvals.view') }, // the checker permission is per action, see approvals tests
  'approvals/[id]/cancel': { POST: perm('approvals.view') },
  'approvals/[id]/reject': { POST: perm('approvals.view') },
  'audit': { GET: perm('audit.read') },
  'contributions': { GET: perm('contributions.read'), POST: perm('contributions.record') },
  'contributions/[id]': { GET: { memberOr: 'contributions.read' } },
  'contributions/[id]/reverse': { POST: perm('contributions.reverse') },
  'dues': { GET: perm('contributions.read') },
  'dashboard': { GET: perm('dashboard.view') },
  'health': { GET: { public: true } },
  'loan-history': { GET: perm('loans.read') },
  'loan-history/review': { GET: perm('loans.read') },
  'loan-history/review/link-exact': { POST: perm('loans.link_history') },
  'loan-history/[id]/link': { POST: perm('loans.link_history') },
  'loan-history/[id]/confirm': { POST: perm('loans.link_history') },
  'loan-payments': { GET: perm('loan_payments.read'), POST: perm('loan_payments.record') },
  'loans': { GET: perm('loans.read'), POST: perm('loans.create') },
  'loans/[id]': { GET: perm('loans.read'), PATCH: perm('loans.update') },
  'loans/[id]/disburse': { POST: perm('loans.disburse') },
  'loans/[id]/write-off': { POST: perm('loans.write_off') },
  'loan-fees/[id]/waive': { POST: perm('loan_fees.waive') },
  'loans/check-policy': { POST: perm('loans.create') },
  'ledger/accounts': { GET: perm('ledger.read') },
  'ledger/accounts/approve': { POST: perm('ledger.manage_accounts') },
  'ledger/comparison': { GET: perm('ledger.read'), POST: perm('ledger.manage_accounts') },
  'ledger/entries': { GET: perm('ledger.read'), POST: perm('ledger.propose') },
  'ledger/invariants': { GET: perm('ledger.read') },
  'ledger/opening': { GET: perm('ledger.read'), POST: perm('ledger.manage_accounts') },
  'ledger/trial-balance': { GET: perm('ledger.read') },
  'treasury': { GET: perm('treasury.read') },
  'reconciliation': { GET: perm('ledger.read') },
  'reconciliation/transfers': { POST: perm('treasury.record_transfer') },
  'ledger/reads': { GET: perm('ledger.read') },
  'reconciliation/bank': { POST: perm('ledger.reconcile') },
  'reconciliation/close': { POST: perm('ledger.close_period') },
  'treasury/bank-balance': { POST: perm('treasury.record_balance') },
  'me': { GET: { staffSession: true } },
  'me/mfa/recovery-codes': { POST: { staff: true } },
  'me/mfa/setup': { POST: { staffSession: true } },
  'me/mfa/verify': { POST: { staffSession: true } },
  'me/password': { POST: { staff: true } },
  'me/sessions': { GET: { staff: true }, DELETE: { staff: true } },
  'members': { GET: perm('members.read'), POST: perm('members.create') },
  'members/[id]': { GET: perm('members.read'), PATCH: perm('members.update') }, // no DELETE (Gate #1 A3)
  'members/[id]/dues': { GET: perm('contributions.read'), POST: perm('dues.manage_plans') },
  'members/[id]/promote-admin': { POST: perm('staff.manage') },
  'members/[id]/statements': { GET: perm('members.read') },
  'members/[id]/statements/[period]': { GET: perm('members.read') },
  'members/[id]/set-password': { POST: perm('members.portal_access') },
  'notifications': { GET: perm('notifications.read'), POST: perm('notifications.send') },
  'payments': { GET: perm('payments.read') },
  'payments/[id]/confirm': { POST: perm('payments.review') },
  'payments/[id]/reject': { POST: perm('payments.review') },
  'portal/dues': { GET: { member: true } },
  'portal/history': { GET: { member: true } },
  'portal/loans': { GET: { member: true } },
  'portal/statements': { GET: { member: true } },
  'portal/statements/[period]': { GET: { member: true } },
  'portal/me': { GET: { member: true } },
  'portal/payments': { GET: { member: true } },
  'portal/payments/checkout': { POST: { member: true } },
  'staff': { GET: perm('staff.read'), POST: perm('staff.manage') },
  'staff/[id]': { PATCH: perm('staff.manage') }, // no DELETE: accounts are disabled, not deleted
  'staff/[id]/reset-mfa': { POST: perm('staff.manage') },
  'staff/[id]/revoke-sessions': { POST: perm('staff.manage') },
  'webhooks/stripe': { POST: { public: true } },
  'withdrawals': { GET: perm('withdrawals.read'), POST: perm('withdrawals.record') },
}

// NextAuth's own sign-in endpoints.
const EXCLUDED = new Set(['auth/[...nextauth]'])

const API_DIR = path.resolve(__dirname, '../src/app/api')
const METHODS: Method[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

function discoverRoutes(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') found.push(path.relative(API_DIR, dir).split(path.sep).join('/'))
    }
  }
  walk(API_DIR)
  return found.sort()
}

function holds(actor: Actor, permission: Permission): boolean {
  if (!isRoleKey(actor)) return false
  return (ROLES[actor].permissions as readonly string[]).includes(permission)
}

function allowed(req: Requirement, actor: Actor): boolean {
  const isStaff = actor !== 'anonymous' && actor !== 'member'
  if ('public' in req) return true
  if ('member' in req) return actor === 'member'
  if ('staffSession' in req) return isStaff
  if ('staff' in req) return isStaff && actor !== 'staff_mfa_pending'
  if ('memberOr' in req) return actor === 'member' || holds(actor, req.memberOr)
  return holds(actor, req.perm)
}

/** What the handler source asks the DAL for, as a Requirement. */
function declaredRequirement(handlerSource: string): Requirement | null {
  const m = handlerSource.match(/require(Permission|MemberOrPermission|Member|StaffSession|Staff)\((?:'([^']+)')?\)/)
  if (!m) return { public: true }
  const [, kind, arg] = m
  switch (kind) {
    case 'Permission': return { perm: arg as Permission }
    case 'MemberOrPermission': return { memberOr: arg as Permission }
    case 'Member': return { member: true }
    case 'StaffSession': return { staffSession: true }
    case 'Staff': return { staff: true }
  }
  return null
}

function handlerSources(source: string): Partial<Record<Method, string>> {
  const out: Partial<Record<Method, string>> = {}
  const parts = source.split(/(?=export async function (?:GET|POST|PATCH|PUT|DELETE)\b)/)
  for (const part of parts) {
    const m = part.match(/^export async function (GET|POST|PATCH|PUT|DELETE)\b/)
    if (m) out[m[1] as Method] = part
  }
  return out
}

async function call(route: string, method: Method) {
  const mod = await import(path.join(API_DIR, route, 'route.ts'))
  const handler = mod[method] as (req: NextRequest, ctx: unknown) => Promise<Response>
  const url = `http://localhost/api/${route.replace('[id]', 'does-not-exist')}`
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } }
  if (method !== 'GET') init.body = '{}'
  return handler(new NextRequest(url, init as any), { params: Promise.resolve({ id: 'does-not-exist' }) })
}

describe('authorization matrix', () => {
  beforeAll(async () => {
    await resetDatabase()
    await createBaseFixtures()
  })

  it('covers every API route and method', async () => {
    const routes = discoverRoutes().filter((r) => !EXCLUDED.has(r))
    expect(routes).toEqual(Object.keys(MATRIX).sort())
    for (const route of routes) {
      const mod = await import(path.join(API_DIR, route, 'route.ts'))
      const exported = METHODS.filter((m) => typeof mod[m] === 'function')
      expect(exported, route).toEqual(METHODS.filter((m) => MATRIX[route][m]))
    }
  })

  it('each handler checks exactly the listed requirement', () => {
    for (const [route, methods] of Object.entries(MATRIX)) {
      const source = fs.readFileSync(path.join(API_DIR, route, 'route.ts'), 'utf8')
      const handlers = handlerSources(source)
      for (const [method, requirement] of Object.entries(methods)) {
        expect(declaredRequirement(handlers[method as Method] ?? ''), `${method} /api/${route}`).toEqual(requirement)
      }
    }
  })

  const cases = Object.entries(MATRIX).flatMap(([route, methods]) =>
    Object.entries(methods).flatMap(([method, requirement]) =>
      ACTORS.map((actor) => ({ route, method: method as Method, requirement: requirement as Requirement, actor })),
    ),
  )

  it.each(cases)('$method /api/$route as $actor', async ({ route, method, requirement, actor }) => {
    signInAs(actor)
    const res = await call(route, method)
    if (allowed(requirement, actor)) {
      expect([401, 403], `expected ${actor} to get past the auth check`).not.toContain(res.status)
    } else if (actor === 'anonymous') {
      expect(res.status).toBe(401)
    } else {
      expect(res.status).toBe(403)
    }
  })
})
