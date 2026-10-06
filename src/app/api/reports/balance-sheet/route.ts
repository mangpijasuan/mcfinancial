import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { badRequest } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { balanceSheet, reportDate } from '@/modules/accounting/reports'

// Amounts are integer cents.
export async function GET(req: NextRequest) {
  const auth = await requirePermission('ledger.read')
  if (auth.error) return auth.error
  const asOf = reportDate(req.nextUrl.searchParams.get('asOf'), todayIso())
  if (!asOf) return badRequest('asOf must be YYYY-MM-DD.')
  return NextResponse.json(await balanceSheet(prisma, asOf))
}
