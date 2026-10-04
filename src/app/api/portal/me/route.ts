import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireMember } from '@/modules/auth'
import { sanitizeMember } from '@/lib/serializers'
import { withLoanBalances, withMemberFigures } from '@/modules/accounting/reads'

export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error
  const memberId = auth.principal.memberId

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      // Loans made before agreements existed (and older loans moved in by M9) have none.
      loansAsBorrower: {
        where: { OR: [{ agreement: { is: null } }, { agreement: { is: { status: { not: 'cancelled' } } } }] },
        include: { payments: { orderBy: { paymentDate: 'desc' }, take: 5 } },
        orderBy: { loanDate: 'desc' },
        take: 1,
      },
      contributions: {
        orderBy: { paymentDate: 'desc' },
        take: 6,
      },
    },
  })

  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Balances from the ledger once screens read from it (M6).
  const [figures] = await withMemberFigures(prisma, [member])
  const loansAsBorrower = await withLoanBalances(prisma, member.loansAsBorrower)
  // Strip sensitive fields
  return NextResponse.json(sanitizeMember({ ...member, overallContributions: figures.overallContributions, loansAsBorrower } as any))
}
