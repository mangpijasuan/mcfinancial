// Staff account management rules, shared by the staff API routes.
import type { Prisma, PrismaClient } from '@prisma/client'
import { ROLES, ROLE_KEYS, isPrivilegedRole, isRoleKey, roleLabel, type RoleKey } from '@/modules/permissions'
import type { StaffPrincipal } from '@/modules/auth'

type Db = PrismaClient | Prisma.TransactionClient

export const STAFF_PASSWORD_MIN_LENGTH = 12

export type StaffRuleError = { status: 400 | 403 | 409; error: string }

/** Validates a role list from a request body. */
export function parseRoles(input: unknown): RoleKey[] | StaffRuleError {
  if (!Array.isArray(input)) return { status: 400, error: 'roles must be a list of role keys.' }
  const unknown = input.filter((r) => !isRoleKey(r))
  if (unknown.length) return { status: 400, error: `Unknown role: ${unknown.join(', ')}` }
  return Array.from(new Set(input as RoleKey[]))
}

export function isRuleError(value: unknown): value is StaffRuleError {
  return Boolean(value && typeof value === 'object' && 'error' in value && 'status' in value)
}

/**
 * Who may change what:
 * - nobody manages their own account here (own password and MFA are on
 *   the Security page), so nobody can raise their own access;
 * - only a Super Admin may act on a Super Admin account, or grant or
 *   revoke a privileged role.
 */
export function checkCanManage(
  actor: StaffPrincipal,
  target: { id: string; roles: readonly string[] },
  change: { addRoles?: readonly string[]; removeRoles?: readonly string[] } = {},
): StaffRuleError | null {
  if (actor.id === target.id) {
    return { status: 409, error: 'You cannot change your own account here. Use your Security page.' }
  }
  const touchesPrivileged =
    target.roles.some(isPrivilegedRole) ||
    (change.addRoles ?? []).some(isPrivilegedRole) ||
    (change.removeRoles ?? []).some(isPrivilegedRole)
  if (touchesPrivileged && !actor.roles.includes('super_admin')) {
    return { status: 403, error: 'Only a Super Admin can change Super Admin access.' }
  }
  return null
}

/** At least one enabled account with the Super Admin role must remain. */
export async function superAdminWouldRemain(db: Db, excludingAdminId: string): Promise<boolean> {
  const others = await db.user.count({
    where: { kind: 'staff', id: { not: excludingAdminId }, disabledAt: null, roles: { some: { role: 'super_admin' } } },
  })
  return others > 0
}

/** Replaces an account's role assignments; returns before/after lists. */
export async function setRoles(db: Db, userId: string, roles: RoleKey[], grantedBy: string | null) {
  const current = await db.staffRoleAssignment.findMany({ where: { userId }, select: { role: true } })
  const before = current.map((r) => r.role).sort()
  const remove = before.filter((r) => !roles.includes(r as RoleKey))
  const add = roles.filter((r) => !before.includes(r))
  if (remove.length) await db.staffRoleAssignment.deleteMany({ where: { userId, role: { in: remove } } })
  if (add.length) await db.staffRoleAssignment.createMany({ data: add.map((role) => ({ userId, role, grantedBy })) })
  return { before, after: [...roles].sort(), added: add, removed: remove }
}

type StaffRow = {
  id: string
  email: string | null
  name: string
  createdAt: Date
  disabledAt: Date | null
  lastLoginAt: Date | null
  mfaEnabledAt: Date | null
  memberId: string | null
  roles: { role: string }[]
}

export const staffSelect = {
  id: true, email: true, name: true, createdAt: true, disabledAt: true, lastLoginAt: true,
  mfaEnabledAt: true, memberId: true, roles: { select: { role: true } },
} satisfies Prisma.UserSelect

/** What the staff screens may see about an account — never secrets. */
export function staffDto(row: StaffRow) {
  const roles = row.roles.map((r) => r.role).sort()
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roles,
    roleLabels: roles.map(roleLabel),
    disabled: Boolean(row.disabledAt),
    mfaEnabled: Boolean(row.mfaEnabledAt),
    lastLoginAt: row.lastLoginAt,
    linkedMemberId: row.memberId,
    createdAt: row.createdAt,
  }
}

export function roleCatalogue() {
  return ROLE_KEYS.map((key) => {
    const def = ROLES[key] as { label: string; description: string; permissions: readonly string[]; privileged?: boolean; transitional?: boolean }
    return {
      key,
      label: def.label,
      description: def.description,
      permissions: [...def.permissions],
      privileged: Boolean(def.privileged),
      transitional: Boolean(def.transitional),
    }
  })
}
