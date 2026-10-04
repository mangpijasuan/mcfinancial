import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { auditContext } from '@/modules/audit'
import { linkExactMatches } from '@/modules/loans/history'

// Link every older loan whose name belongs to exactly one member (M9).
export async function POST(req: NextRequest) {
  const auth = await requirePermission('loans.link_history')
  if (auth.error) return auth.error
  const result = await prisma.$transaction((tx) => linkExactMatches(tx, auditContext(req, auth.principal)), { timeout: 60_000 })
  return NextResponse.json(result)
}
