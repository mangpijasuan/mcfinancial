import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkLoanPolicy } from '@/lib/loanPolicy'
import { requirePermission } from '@/modules/auth'
import { badRequest, readJsonObject, requiredString } from '@/lib/http'
import { forLoanPolicy } from '@/modules/accounting/reads'
import { boardRuleOn } from '@/modules/policy/boardRules'

// The loan rules waiting for the board that change the new-loan form.
export async function GET() {
  const auth = await requirePermission('loans.create')
  if (auth.error) return auth.error
  return NextResponse.json({ cosignerRequired: boardRuleOn('cosignerRequired'), loanTermBands: boardRuleOn('loanTermBands') })
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('loans.create')
  if (auth.error) return auth.error

  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const memberId = requiredString(body.memberId)
  if (!memberId) return badRequest('A member must be selected.')
  const { amount, termMonths } = body

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true, status: true, monthsActive: true,
      archiveLifetime: true, contributions2026: true,
      activeAsBorrower: true, activeAsCosigner: true, eligible: true,
    },
  })

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Check if they have a recently paid-off loan
  const lastPaidLoan = await prisma.loan.findFirst({
    where: { borrowerId: memberId, status: 'Paid Off' },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })

  const result = checkLoanPolicy(
    await prisma.$transaction((tx) => forLoanPolicy(tx, member)),
    parseFloat(amount) || 0,
    parseInt(termMonths) || 12,
    lastPaidLoan?.updatedAt,
    { termBands: boardRuleOn('loanTermBands') },
  )

  return NextResponse.json(result)
}
