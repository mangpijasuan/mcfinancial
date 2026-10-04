import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { badRequest, notFound, readJsonObject, requiredString } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { revokeStaffSessions } from '@/modules/auth/sessions'
import { auditContext, recordAudit } from '@/modules/audit'
import {
  STAFF_PASSWORD_MIN_LENGTH, checkCanManage, isRuleError, parseRoles, setRoles, staffDto, staffSelect, superAdminWouldRemain,
} from '@/modules/staff'

// Staff accounts are disabled, never deleted, so the audit trail keeps
// pointing at a real account.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('staff.manage')
  if (auth.error) return auth.error

  const { id } = await params
  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const target = await prisma.user.findFirst({ where: { id, kind: 'staff' }, select: staffSelect })
  if (!target) return notFound('Staff account not found.')
  const currentRoles = target.roles.map((r) => r.role)

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = requiredString(body.name)
    if (!name) return badRequest('Name cannot be empty.')
    data.name = name
  }
  if (body.email !== undefined) {
    const email = requiredString(body.email)?.toLowerCase()
    if (!email) return badRequest('Email cannot be empty.')
    const clash = await prisma.user.findFirst({ where: { id: { not: id }, email: { equals: email, mode: 'insensitive' } } })
    if (clash) return NextResponse.json({ error: 'Another staff account already uses that email.' }, { status: 409 })
    data.email = email
  }
  let passwordChanged = false
  if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < STAFF_PASSWORD_MIN_LENGTH) {
      return badRequest(`Password must be at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`)
    }
    data.passwordHash = await bcrypt.hash(body.password, 10)
    passwordChanged = true
  }
  let disabling = false
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== 'boolean') return badRequest('disabled must be true or false.')
    disabling = body.disabled && !target.disabledAt
    data.disabledAt = body.disabled ? (target.disabledAt ?? new Date()) : null
  }
  let roles: string[] | undefined
  if (body.roles !== undefined) {
    const parsed = parseRoles(body.roles)
    if (isRuleError(parsed)) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    roles = parsed
  }

  const denied = checkCanManage(auth.principal, { id, roles: currentRoles }, {
    addRoles: roles?.filter((r) => !currentRoles.includes(r)),
    removeRoles: roles ? currentRoles.filter((r) => !roles!.includes(r)) : undefined,
  })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const losesSuperAdmin = currentRoles.includes('super_admin') && (disabling || (roles !== undefined && !roles.includes('super_admin')))
  if (losesSuperAdmin && !(await superAdminWouldRemain(prisma, id))) {
    return NextResponse.json({ error: 'At least one active Super Admin account must remain.' }, { status: 409 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.user.update({ where: { id }, data })
    if (roles !== undefined) await setRoles(tx, id, roles as any, auth.principal.id)
    // A new password or a disabled account ends every session at once.
    const revoked = passwordChanged || disabling
      ? await revokeStaffSessions(tx, id, disabling ? 'account_disabled' : 'password_reset')
      : 0
    const after = await tx.user.findUniqueOrThrow({ where: { id }, select: staffSelect })
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: roles !== undefined && Object.keys(data).length === 0 ? 'staff.roles.update' : 'staff.update',
      entityType: 'admin', entityId: id, before: staffDto(target), after: staffDto(after),
      metadata: { passwordChanged, sessionsRevoked: revoked },
    })
    return after
  })

  return NextResponse.json(staffDto(updated))
}
