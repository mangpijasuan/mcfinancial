import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { requireMember } from '@/modules/auth'
import { statementPeriods } from '@/modules/accounting/statements'

// The months and years the signed-in member can see a statement for.
export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error
  return NextResponse.json({ periods: await statementPeriods(prisma, todayIso()) })
}
