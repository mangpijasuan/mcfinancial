import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { readSource, readsParity } from '@/modules/accounting/reads'
import { comparisonStatus } from '@/modules/accounting/comparison'

// M6: where screens read balances from, and every such figure from both
// sources side by side. One Repeatable Read snapshot, so a payment recorded
// meanwhile cannot appear on one side only.
export async function GET() {
  const auth = await requirePermission('ledger.read')
  if (auth.error) return auth.error
  const result = await prisma.$transaction(async (tx) => {
    const [source, parity, comparison] = await Promise.all([readSource(tx), readsParity(tx), comparisonStatus(tx)])
    return { source, parity, streak: comparison.started ? { ...comparison.streak, target: comparison.target } : null }
  }, { isolationLevel: 'RepeatableRead', timeout: 60_000 })
  return NextResponse.json(result)
}
