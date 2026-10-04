import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { sanitizeMember } from '@/lib/serializers'
import { nextMemberId } from '@/lib/publicIds'
import { auditContext, recordAudit } from '@/modules/audit'
import { badRequest, parseDate, readJsonObject, requiredString } from '@/lib/http'
import { withMemberFigures } from '@/modules/accounting/reads'

export async function GET(req: NextRequest) {
  const auth = await requirePermission('members.read')
  if (auth.error) return auth.error

  const s = new URL(req.url).searchParams
  const search = s.get('search') || ''
  const status = s.get('status') || ''
  const risk   = s.get('risk') || ''
  const paid   = s.get('paid') || ''
  const page   = Math.max(1, parseInt(s.get('page') || '1'))
  const limit  = parseInt(s.get('limit') || '10')

  const where: any = {}
  if (search) where.OR = [
    { legalName: { contains: search, mode: 'insensitive' } },
    { nickname:  { contains: search, mode: 'insensitive' } },
    { id:        { contains: search, mode: 'insensitive' } },
  ]
  if (status) where.status   = status
  if (risk)   where.riskFlag = risk
  if (paid)   where.thisMonth = paid

  const [members, total] = await Promise.all([
    prisma.member.findMany({ where, orderBy: { id: 'asc' }, skip: (page - 1) * limit, take: limit }),
    prisma.member.count({ where }),
  ])
  const shown = await withMemberFigures(prisma, members)
  return NextResponse.json({ members: shown.map(sanitizeMember), total, page, pages: Math.ceil(total / limit) })
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('members.create')
  if (auth.error) return auth.error

  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const legalName = requiredString(body.legalName)
  if (!legalName) return badRequest('Legal name is required.')
  const joinDate = parseDate(body.joinDate)
  if (!joinDate) return badRequest('A valid join date is required.')
  const id = nextMemberId()

  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.member.create({
      data: {
      id,
      legalName,
      nickname: body.nickname || null,
      joinDate,
      status: body.status || 'Active',
      phoneNo: body.phoneNo || null,
      email: body.email || null,
      beneficiary: body.beneficiary || null,
      notes: body.notes || null,
      },
    })
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'member.create', entityType: 'member', entityId: created.id, after: created,
    })
    return created
  })
  return NextResponse.json(sanitizeMember(member), { status: 201 })
}
