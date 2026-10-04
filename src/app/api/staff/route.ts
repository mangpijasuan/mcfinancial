import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { badRequest, readJsonObject, requiredString } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { auditContext, recordAudit } from '@/modules/audit'
import {
  STAFF_PASSWORD_MIN_LENGTH, checkCanManage, isRuleError, parseRoles, roleCatalogue, setRoles, staffDto, staffSelect,
} from '@/modules/staff'

export async function GET() {
  const auth = await requirePermission('staff.read')
  if (auth.error) return auth.error

  const rows = await prisma.user.findMany({ where: { kind: 'staff' }, select: staffSelect, orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ staff: rows.map(staffDto), roles: roleCatalogue() })
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('staff.manage')
  if (auth.error) return auth.error

  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const name = requiredString(body.name)
  const email = requiredString(body.email)?.toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!name || !email) return badRequest('Name and email are required.')
  if (password.length < STAFF_PASSWORD_MIN_LENGTH) {
    return badRequest(`Password must be at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`)
  }
  const roles = parseRoles(body.roles ?? [])
  if (isRuleError(roles)) return NextResponse.json({ error: roles.error }, { status: roles.status })
  const denied = checkCanManage(auth.principal, { id: '', roles: [] }, { addRoles: roles })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
  if (existing) return NextResponse.json({ error: 'A staff account with that email already exists.' }, { status: 409 })

  const hashed = await bcrypt.hash(password, 10)
  const created = await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({ data: { kind: 'staff', email, name, passwordHash: hashed } })
    await setRoles(tx, admin.id, roles, auth.principal.id)
    const row = await tx.user.findUniqueOrThrow({ where: { id: admin.id }, select: staffSelect })
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.create', entityType: 'admin', entityId: admin.id, after: staffDto(row),
    })
    return row
  })

  return NextResponse.json(staffDto(created), { status: 201 })
}
