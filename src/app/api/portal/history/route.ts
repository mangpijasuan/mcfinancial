import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireMember } from '@/modules/auth'
import { HISTORY_FIELDS } from '@/modules/loans/history'

export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error
  const memberId = auth.principal.memberId

  const [member, yearlyTotals, contributions2026, historical] = await Promise.all([
    prisma.member.findUnique({ where: { id: memberId }, select: { id: true } }),
    prisma.yearlyTotal.findMany({
      where: { memberId },
      orderBy: { year: 'asc' },
    }),
    prisma.contribution.findMany({
      where: { memberId },
      orderBy: { paymentDate: 'desc' },
    }),
    // Only loans linked to this member by ID (M9). Matching by name showed a
    // member the loans of anyone sharing their name.
    prisma.historicalLoan.findMany({
      where: { year: { gte: 2024 }, OR: [{ borrowerId: memberId }, { cosignerId: memberId }] },
      select: HISTORY_FIELDS,
      orderBy: [{ year: 'desc' }, { loanDate: 'desc' }],
    }),
  ])

  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const historicalLoansAsBorrower = historical.filter((loan) => loan.borrowerId === memberId)
  const historicalLoansAsCosigner = historical.filter((loan) => loan.cosignerId === memberId)

  return NextResponse.json({
    yearlyTotals,
    contributions2026,
    historicalLoansAsBorrower,
    historicalLoansAsCosigner,
  })
}
