import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { badRequest } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { incomeStatement, reportRange } from '@/modules/accounting/reports'

// Amounts are integer cents. The range defaults to the year to date.
export async function GET(req: NextRequest) {
  const auth = await requirePermission('ledger.read')
  if (auth.error) return auth.error
  const q = req.nextUrl.searchParams
  const range = reportRange(q.get('from'), q.get('to'), todayIso())
  if (!range) return badRequest('from and to must be YYYY-MM-DD, with from on or before to.')
  return NextResponse.json(await incomeStatement(prisma, range.from, range.to))
}
