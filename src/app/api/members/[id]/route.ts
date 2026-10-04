import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { can, requirePermission } from '@/modules/auth'
import { roleLabel } from '@/modules/permissions'
import { sanitizeMember } from '@/lib/serializers'
import { auditContext, recordAudit } from '@/modules/audit'
import { onMemberStatusChange } from '@/modules/contributions'
import { badRequest, notFound, parseDate, readJsonObject } from '@/lib/http'
import { HISTORY_FIELDS } from '@/modules/loans/history'
import { portalAccess } from '@/modules/auth/memberLogins'
import { withLoanBalances, withMemberFigures } from '@/modules/accounting/reads'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('members.read')
  if (auth.error) return auth.error

  const { id } = await params
  const member = await prisma.member.findUnique({
    where: { id },
    include: {
      contributions: { orderBy: { paymentDate: 'desc' }, take: 24 },
      // Loans made before agreements existed (and older loans moved in by M9) have none.
      loansAsBorrower: {
        where: { OR: [{ agreement: { is: null } }, { agreement: { is: { status: { not: 'cancelled' } } } }] },
        include: { payments: { orderBy: { paymentDate: 'desc' } } },
      },
      yearlyTotals: { orderBy: { year: 'asc' } },
    },
  })
  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Older loans by the member ID they were linked to (M9), never by name.
  const historical = await prisma.historicalLoan.findMany({
    where: { OR: [{ borrowerId: id }, { cosignerId: id }] },
    select: HISTORY_FIELDS,
    orderBy: [{ year: 'desc' }, { loanDate: 'desc' }],
  })
  // A linked staff account is shown only to people who may see staff.
  const linkedAdmin = can(auth.principal, 'staff.read')
    ? await prisma.user.findFirst({
        where: { kind: 'staff', memberId: id },
        select: { id: true, email: true, name: true, createdAt: true, disabledAt: true, roles: { select: { role: true } } },
      })
    : null

  const historicalLoansAsBorrower = historical.filter((loan) => loan.borrowerId === id)
  const historicalLoansAsCosigner = historical.filter((loan) => loan.cosignerId === id)

  const [figures] = await withMemberFigures(prisma, [member])
  const loansAsBorrower = await withLoanBalances(prisma, member.loansAsBorrower)
  return NextResponse.json({
    ...sanitizeMember({ ...figures, loansAsBorrower }),
    portalEnabled: await portalAccess(prisma, id),
    linkedAdmin: linkedAdmin
      ? {
          id: linkedAdmin.id,
          email: linkedAdmin.email,
          name: linkedAdmin.name,
          roles: linkedAdmin.roles.map((r) => r.role),
          roleLabel: linkedAdmin.roles.map((r) => roleLabel(r.role)).join(', ') || 'No roles',
          disabled: Boolean(linkedAdmin.disabledAt),
          createdAt: linkedAdmin.createdAt,
        }
      : null,
    historicalLoansAsBorrower,
    historicalLoansAsCosigner,
  })
}

const EDITABLE_MEMBER_FIELDS = [
  'legalName', 'nickname', 'status', 'phoneNo', 'email',
  'beneficiary', 'notes', 'riskFlag',
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('members.update')
  if (auth.error) return auth.error

  const { id } = await params
  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const existing = await prisma.member.findUnique({ where: { id } })
  if (!existing) return notFound()

  const data: Record<string, unknown> = {}
  for (const field of EDITABLE_MEMBER_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field]
  }
  if (data.legalName !== undefined && !(typeof data.legalName === 'string' && data.legalName.trim())) {
    return badRequest('Legal name cannot be empty.')
  }
  if (body.joinDate !== undefined) {
    const joinDate = parseDate(body.joinDate)
    if (!joinDate) return badRequest('Invalid join date.')
    data.joinDate = joinDate
  }
  // lastContributionDate and thisMonth follow from recorded contributions
  // (src/modules/contributions); they are not edited by hand.
  if (data.status !== undefined && data.status !== existing.status && !['Active', 'Inactive'].includes(data.status as string)) {
    return badRequest('Status must be Active or Inactive.')
  }

  const member = await prisma.$transaction(async (tx) => {
    const updated = await tx.member.update({ where: { id }, data })
    // No dues accrue while inactive; reactivating does not bill the months away.
    await onMemberStatusChange(tx, id, existing.status, updated.status)
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'member.update', entityType: 'member', entityId: id, before: existing, after: updated,
    })
    return updated
  })
  return NextResponse.json(sanitizeMember(member))
}

// No DELETE: members are never hard-deleted (Gate #1 A3). Set the status
// to Inactive instead, which keeps their financial history intact.
