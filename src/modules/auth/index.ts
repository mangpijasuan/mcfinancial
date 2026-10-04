// Data Access Layer for authentication and authorisation (D-07).
//
// The NextAuth cookie only says who someone claims to be. Every protected
// request resolves that claim against the database here: the staff
// session row (revocation, 12 h / 30 min limits, MFA state), the account
// (disabled?) and its current roles. Nothing about permissions is trusted
// from the cookie, so a role change or a disabled account takes effect on
// the very next request (fixes S-1).
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { permissionsForRoles, type Permission, type RoleKey, isRoleKey } from '@/modules/permissions'
import {
  STAFF_SESSION_IDLE_MS,
  STAFF_SESSION_TOUCH_MS,
  hashSessionToken,
} from './sessions'

export type StaffPrincipal = {
  kind: 'staff'
  id: string
  email: string
  name: string
  roles: RoleKey[]
  permissions: Set<Permission>
  sessionId: string
  mfaEnrolled: boolean
  mfaVerified: boolean
}

export type MemberPrincipal = {
  kind: 'member'
  memberId: string
  name: string
}

export type Principal = StaffPrincipal | MemberPrincipal

type SessionUser = {
  id?: string
  kind?: 'staff' | 'member'
  sid?: string
  memberId?: string
  loginAt?: number
}

async function resolveStaff(user: SessionUser): Promise<StaffPrincipal | null> {
  if (!user.sid || !user.id) return null
  const sessionId = hashSessionToken(user.sid)
  const row = await prisma.staffSession.findUnique({
    where: { id: sessionId },
    include: { user: { include: { roles: { select: { role: true } } } } },
  })
  if (!row || row.revokedAt || row.userId !== user.id || row.user.kind !== 'staff') return null

  const now = Date.now()
  if (now >= row.expiresAt.getTime() || now - row.lastSeenAt.getTime() > STAFF_SESSION_IDLE_MS) {
    const reason = now >= row.expiresAt.getTime() ? 'expired' : 'idle'
    await prisma.staffSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } })
    return null
  }
  if (row.user.disabledAt) return null

  if (now - row.lastSeenAt.getTime() > STAFF_SESSION_TOUCH_MS) {
    await prisma.staffSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
  }

  const roles = row.user.roles.map((r) => r.role).filter(isRoleKey)
  return {
    kind: 'staff',
    id: row.user.id,
    email: row.user.email!,
    name: row.user.name,
    roles,
    permissions: permissionsForRoles(roles),
    sessionId,
    mfaEnrolled: Boolean(row.user.mfaEnabledAt),
    mfaVerified: Boolean(row.mfaVerifiedAt),
  }
}

async function resolveMember(user: SessionUser): Promise<MemberPrincipal | null> {
  if (!user.memberId) return null
  // The member's login (M8): switched off, or sessions cut off since, means signed out.
  const login = await prisma.user.findUnique({
    where: { kind_memberId: { kind: 'member', memberId: user.memberId } },
    select: { disabledAt: true, sessionsValidAfter: true, member: { select: { id: true, legalName: true } } },
  })
  if (!login || login.disabledAt || !login.member) return null
  const validAfter = login.sessionsValidAfter?.getTime()
  if (validAfter && !(typeof user.loginAt === 'number' && user.loginAt >= validAfter)) return null
  return { kind: 'member', memberId: login.member.id, name: login.member.legalName }
}

/** Who is making this request, checked against the database; null if nobody (valid). */
export async function getPrincipal(): Promise<Principal | null> {
  const session = await getServerSession(authOptions)
  const user = (session?.user ?? null) as SessionUser | null
  if (!user) return null
  if (user.kind === 'staff') return resolveStaff(user)
  if (user.kind === 'member') return resolveMember(user)
  return null
}

export function can(principal: Principal | null | undefined, permission: Permission): boolean {
  return principal?.kind === 'staff' && principal.mfaVerified && principal.permissions.has(permission)
}

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })
const mfaRequired = () =>
  NextResponse.json({ error: 'Set up two-factor authentication to continue.', code: 'MFA_REQUIRED' }, { status: 403 })

type Guard<P> = { principal: P; error?: undefined } | { principal?: undefined; error: NextResponse }

/** Staff with a verified second factor and the given permission. */
export async function requirePermission(permission: Permission): Promise<Guard<StaffPrincipal>> {
  const principal = await getPrincipal()
  if (!principal) return { error: unauthorized() }
  if (principal.kind !== 'staff') return { error: forbidden() }
  if (!principal.mfaVerified) return { error: mfaRequired() }
  if (!principal.permissions.has(permission)) return { error: forbidden() }
  return { principal }
}

/** Any signed-in staff member with a verified second factor (own account pages). */
export async function requireStaff(): Promise<Guard<StaffPrincipal>> {
  const principal = await getPrincipal()
  if (!principal) return { error: unauthorized() }
  if (principal.kind !== 'staff') return { error: forbidden() }
  if (!principal.mfaVerified) return { error: mfaRequired() }
  return { principal }
}

/** A staff session that may not have passed MFA yet — only for MFA enrolment. */
export async function requireStaffSession(): Promise<Guard<StaffPrincipal>> {
  const principal = await getPrincipal()
  if (!principal) return { error: unauthorized() }
  if (principal.kind !== 'staff') return { error: forbidden() }
  return { principal }
}

export async function requireMember(): Promise<Guard<MemberPrincipal>> {
  const principal = await getPrincipal()
  if (!principal) return { error: unauthorized() }
  if (principal.kind !== 'member') return { error: forbidden() }
  return { principal }
}

/**
 * A member (the handler must then check ownership) or staff holding the
 * given permission. Used where members and staff share an endpoint.
 */
export async function requireMemberOrPermission(permission: Permission): Promise<Guard<Principal>> {
  const principal = await getPrincipal()
  if (!principal) return { error: unauthorized() }
  if (principal.kind === 'member') return { principal }
  if (!principal.mfaVerified) return { error: mfaRequired() }
  if (!principal.permissions.has(permission)) return { error: forbidden() }
  return { principal }
}
