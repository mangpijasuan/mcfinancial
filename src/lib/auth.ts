import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { LIMITS, clearAttempts, clientIp, ipKey, isRateLimited, recordFailedAttempt } from './rateLimit'
import { sendEmail } from './email'
import { anonymousAuditContext, auditContext, recordAudit } from '@/modules/audit'
import { createStaffSession, hashSessionToken } from '@/modules/auth/sessions'
import { verifySecondFactor } from '@/modules/auth/mfa'
import { signInFollowsRequestHost } from './hosts'

// Members and staff on separate addresses: each sign-in stays on its own (src/lib/hosts.ts).
signInFollowsRequestHost()

// Member sessions last 7 days. Staff sessions are additionally bounded by
// their database row (12 hours, 30 minutes idle) — see src/modules/auth.
const MEMBER_SESSION_MAX_AGE_S = 7 * 24 * 60 * 60

// Errors a sign-in form can act on. Anything else is a generic failure.
export const SIGN_IN_ERRORS = {
  mfaRequired: 'MFA_REQUIRED',
  mfaInvalid: 'MFA_INVALID',
} as const

type RawRequest = { headers?: Record<string, any> } | undefined

// NextAuth hands authorize() a plain header object.
function headerSource(req: RawRequest) {
  return { headers: { get: (name: string) => (req?.headers?.[name] as string | undefined) ?? null } }
}

async function auditSignIn(
  req: RawRequest,
  action: string,
  kind: 'admin' | 'member',
  attempted: string,
  actor?: { kind: 'staff'; id: string; email: string } | { kind: 'member'; memberId: string },
  metadata?: Record<string, unknown>,
) {
  const ctx = actor ? auditContext(headerSource(req), actor) : anonymousAuditContext(attempted, headerSource(req))
  await recordAudit(prisma, ctx, {
    action,
    entityType: kind,
    entityId: actor ? (actor.kind === 'staff' ? actor.id : actor.memberId) : attempted.slice(0, 200),
    metadata,
  }).catch((err) => console.error('audit: failed to record sign-in', err))
}

// Super Admin is break-glass (D-07): every sign-in is flagged and, when
// SECURITY_ALERT_EMAIL is set, emailed to the board.
async function notifyBreakGlass(email: string, ip: string | null) {
  const to = process.env.SECURITY_ALERT_EMAIL
  if (!to) return
  const when = new Date().toISOString()
  await sendEmail(to, 'Super Admin sign-in', `<p>${email.replace(/[<>&"]/g, '')} signed in with Super Admin access at ${when}${ip ? ` from ${ip.replace(/[<>&"]/g, '')}` : ''}.</p>`)
    .catch((err) => console.error('break-glass notification failed', err))
}

// A sign-in was refused because an account or an IP address hit its
// failure limit — a likely guessing attack. Alert once per hour per target
// (throttled through the same attempts table).
async function alertLockout(kind: 'admin' | 'member', attempted: string, ip: string | null) {
  const to = process.env.SECURITY_ALERT_EMAIL
  if (!to) return
  const target = `${kind}:${attempted.toLowerCase()}|${ip ?? '-'}`
  const hourly = { max: 1, windowMs: 60 * 60 * 1000 }
  if (await isRateLimited(`alert:${target}`, hourly)) return
  await recordFailedAttempt(`alert:${target}`)
  const clean = (v: string) => v.replace(/[<>&"]/g, '')
  await sendEmail(to, 'Repeated failed sign-ins',
    `<p>Sign-in attempts for ${kind === 'admin' ? 'staff account' : 'member'} <b>${clean(attempted)}</b>${ip ? ` from ${clean(ip)}` : ''} were blocked after too many failures at ${new Date().toISOString()}.</p><p>Details are in the audit log (auth.login.blocked).</p>`)
    .catch((err) => console.error('lockout alert failed', err))
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: MEMBER_SESSION_MAX_AGE_S },
  jwt: { maxAge: MEMBER_SESSION_MAX_AGE_S },
  pages: { signIn: '/login' },
  providers: [
    // Staff sign-in: email + password, then a TOTP or recovery code.
    CredentialsProvider({
      id: 'admin',
      name: 'Staff',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        code: { label: 'Authentication code', type: 'text' },
      },
      async authorize(creds, req) {
        if (!creds?.email || !creds?.password) return null
        const email = creds.email.trim().toLowerCase()
        const rateLimitKey = `admin:${email}`
        const ip = clientIp(headerSource(req).headers.get)
        if ((await isRateLimited(rateLimitKey)) || (ip && (await isRateLimited(ipKey(ip)!, LIMITS.ip)))) {
          await auditSignIn(req, 'auth.login.blocked', 'admin', email)
          await alertLockout('admin', email, ip)
          return null
        }

        const admin = await prisma.user.findFirst({
          where: { kind: 'staff', email: { equals: email, mode: 'insensitive' } },
          include: { roles: { select: { role: true } } },
        })
        const passwordOk = admin ? await bcrypt.compare(creds.password, admin.passwordHash) : false
        if (!admin || !passwordOk || admin.disabledAt) {
          await recordFailedAttempt(rateLimitKey, ipKey(ip))
          await auditSignIn(req, 'auth.login.failure', 'admin', email, undefined, admin?.disabledAt ? { reason: 'disabled' } : undefined)
          return null
        }
        const actor = { kind: 'staff' as const, id: admin.id, email: admin.email! }

        let mfaMethod = 'not_enrolled'
        if (admin.mfaEnabledAt) {
          const code = creds.code?.trim()
          if (!code) throw new Error(SIGN_IN_ERRORS.mfaRequired)
          const mfaKey = `mfa:${admin.id}`
          if (await isRateLimited(mfaKey, LIMITS.mfa)) {
            await auditSignIn(req, 'auth.mfa.blocked', 'admin', email, actor)
            throw new Error(SIGN_IN_ERRORS.mfaInvalid)
          }
          const result = await verifySecondFactor(prisma, admin, code)
          if (!result.ok) {
            await recordFailedAttempt(mfaKey, ipKey(ip))
            await auditSignIn(req, 'auth.mfa.failure', 'admin', email, actor)
            throw new Error(SIGN_IN_ERRORS.mfaInvalid)
          }
          await clearAttempts(mfaKey)
          mfaMethod = result.method
        }
        await clearAttempts(rateLimitKey)

        const sid = await createStaffSession(prisma, admin.id, {
          mfaVerified: Boolean(admin.mfaEnabledAt),
          ip,
          userAgent: headerSource(req).headers.get('user-agent'),
        })
        await prisma.user.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })

        const roles = admin.roles.map((r) => r.role)
        const breakGlass = roles.includes('super_admin')
        await auditSignIn(req, 'auth.login.success', 'admin', email, actor, { mfa: mfaMethod, roles, breakGlass })
        if (breakGlass) await notifyBreakGlass(admin.email!, ip)

        return { id: admin.id, email: admin.email!, name: admin.name, kind: 'staff', sid } as any
      },
    }),
    // Member sign-in (member ID + password)
    CredentialsProvider({
      id: 'member',
      name: 'Member',
      credentials: {
        memberId: { label: 'Member ID', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds, req) {
        if (!creds?.memberId || !creds?.password) return null
        const attempted = creds.memberId.trim()
        const rateLimitKey = `member:${attempted.toLowerCase()}`
        const ip = clientIp(headerSource(req).headers.get)
        if ((await isRateLimited(rateLimitKey)) || (ip && (await isRateLimited(ipKey(ip)!, LIMITS.ip)))) {
          await auditSignIn(req, 'auth.login.blocked', 'member', attempted)
          await alertLockout('member', attempted, ip)
          return null
        }
        // The member's login (M8), not the member record.
        const login = await prisma.user.findUnique({
          where: { kind_memberId: { kind: 'member', memberId: attempted } },
          include: { member: { select: { id: true, legalName: true, email: true } } },
        })
        const ok = login && !login.disabledAt ? await bcrypt.compare(creds.password, login.passwordHash) : false
        const member = login?.member
        if (!login || !member || !ok) {
          await recordFailedAttempt(rateLimitKey, ipKey(ip))
          await auditSignIn(req, 'auth.login.failure', 'member', attempted)
          return null
        }
        await clearAttempts(rateLimitKey)
        await prisma.user.update({ where: { id: login.id }, data: { lastLoginAt: new Date() } })
        await auditSignIn(req, 'auth.login.success', 'member', attempted, { kind: 'member', memberId: member.id })
        return { id: member.id, email: member.email || '', name: member.legalName, kind: 'member', memberId: member.id } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as any
        token.kind = u.kind
        token.sid = u.sid
        token.memberId = u.memberId
        token.loginAt = Date.now()
      }
      return token
    },
    async session({ session, token }) {
      // Identity claims only. Roles and permissions are never read from
      // here: the Data Access Layer loads them from the database.
      if (session.user) {
        const user = session.user as any
        user.id = token.sub
        user.kind = token.kind
        user.sid = token.sid
        user.memberId = token.memberId
        user.loginAt = token.loginAt
        // Kept for optimistic UI routing (which area to send someone to).
        user.role = token.kind === 'staff' ? 'admin' : 'member'
      }
      return session
    },
  },
  events: {
    async signOut({ token }) {
      const t = token as any
      if (t?.kind === 'staff' && typeof t.sid === 'string') {
        await prisma.staffSession.updateMany({
          where: { id: hashSessionToken(t.sid), revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'signed_out' },
        })
      }
    },
  },
}
