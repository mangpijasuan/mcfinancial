import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { badRequest, readJsonObject } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { auditContext, recordAudit } from '@/modules/audit'
import {
  STAFF_PASSWORD_MIN_LENGTH, checkCanManage, isRuleError, parseRoles, setRoles, staffDto, staffSelect,
} from '@/modules/staff'

// Creates a staff account linked to a member (an officer who is also a
// member). The two sign-ins stay separate identities (D-17).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('staff.manage')
  if (auth.error) return auth.error

  const { id } = await params
  const member = await prisma.member.findUnique({
    where: { id },
    select: { id: true, legalName: true, email: true },
  })
  if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (!member.email) {
    return badRequest('Member must have an email address before getting a staff account.')
  }

  const existingLinked = await prisma.user.findFirst({ where: { kind: 'staff', memberId: member.id }, select: staffSelect })
  if (existingLinked) {
    return NextResponse.json(
      { error: 'This member already has a linked staff account.', admin: staffDto(existingLinked) },
      { status: 409 },
    )
  }

  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < STAFF_PASSWORD_MIN_LENGTH) {
    return badRequest(`Password must be at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`)
  }
  const roles = parseRoles(body.roles ?? [])
  if (isRuleError(roles)) return NextResponse.json({ error: roles.error }, { status: roles.status })
  if (roles.length === 0) return badRequest('Choose at least one role.')
  const denied = checkCanManage(auth.principal, { id: '', roles: [] }, { addRoles: roles })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const adminEmail = member.email.trim().toLowerCase()
  const existingEmail = await prisma.user.findFirst({ where: { email: { equals: adminEmail, mode: 'insensitive' } } })
  if (existingEmail) {
    return NextResponse.json({ error: 'That email already belongs to another staff account.' }, { status: 409 })
  }

  const hashed = await bcrypt.hash(password, 10)
  const admin = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { kind: 'staff', email: adminEmail, name: member.legalName, passwordHash: hashed, memberId: member.id },
    })
    await setRoles(tx, created.id, roles, auth.principal.id)
    const row = await tx.user.findUniqueOrThrow({ where: { id: created.id }, select: staffSelect })
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.create', entityType: 'admin', entityId: created.id, after: staffDto(row),
      metadata: { linkedMemberId: member.id },
    })
    return row
  })

  return NextResponse.json({ ok: true, admin: staffDto(admin) }, { status: 201 })
}
