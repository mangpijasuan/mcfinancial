import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { HISTORY_FIELDS } from '@/modules/loans/history'

export async function GET(req: NextRequest) {
  const auth = await requirePermission('loans.read')
  if (auth.error) return auth.error

  const s = new URL(req.url).searchParams
  const year   = s.get('year') || ''
  const search = s.get('search') || ''
  const status = s.get('status') || ''
  const currentYear = new Date().getFullYear()

  const where: any = {}
  if (year)   where.year   = parseInt(year)
  if (status) where.status = status
  if (search) where.OR = [
    { borrowerName: { contains: search, mode: 'insensitive' } },
    { cosignerName: { contains: search, mode: 'insensitive' } },
    { loanId:       { contains: search, mode: 'insensitive' } },
  ]

  const [loans, byYearHistorical, leaderboard, liveLoansCurrentYear] = await Promise.all([
    prisma.historicalLoan.findMany({
      where,
      select: HISTORY_FIELDS,
      orderBy: [{ year: 'desc' }, { loanDate: 'desc' }],
    }),
    // Year summary
    prisma.historicalLoan.groupBy({
      by: ['year'],
      _sum: { loanAmount: true },
      _count: { id: true },
      orderBy: { year: 'asc' },
    }),
    // Top borrowers (all time), by the member each loan is linked to (M9):
    // two members who share a name are two borrowers.
    prisma.historicalLoan.groupBy({
      by: ['borrowerId', 'borrowerName'],
      _sum: { loanAmount: true },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 15,
    }),
    prisma.loan.findMany({
      where: {
        loanDate: {
          gte: new Date(Date.UTC(currentYear, 0, 1)),
          lt: new Date(Date.UTC(currentYear + 1, 0, 1)),
        },
      },
      select: { loanAmount: true },
    }),
  ])

  const liveCurrentYearSummary = {
    year: currentYear,
    _sum: { loanAmount: liveLoansCurrentYear.reduce((s, l) => s + (l.loanAmount || 0), 0) },
    _count: { id: liveLoansCurrentYear.length },
  }

  const byYearMap = new Map<number, any>()
  for (const row of byYearHistorical) byYearMap.set(row.year, row)
  if (liveCurrentYearSummary._count.id > 0) {
    const existing = byYearMap.get(currentYear)
    if (existing) {
      byYearMap.set(currentYear, {
        year: currentYear,
        _sum: { loanAmount: (existing._sum?.loanAmount || 0) + liveCurrentYearSummary._sum.loanAmount },
        _count: { id: (existing._count?.id || 0) + liveCurrentYearSummary._count.id },
      })
    } else {
      byYearMap.set(currentYear, liveCurrentYearSummary)
    }
  }

  const byYear = Array.from(byYearMap.values()).sort((a, b) => a.year - b.year)

  return NextResponse.json({ loans, byYear, leaderboard })
}
