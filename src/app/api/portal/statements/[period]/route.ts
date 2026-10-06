import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { notFound } from '@/lib/http'
import { requireMember } from '@/modules/auth'
import { memberStatement } from '@/modules/accounting/statements'

// The signed-in member's statement for a month ("2026-09") or a year ("2026").
export async function GET(_: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  const auth = await requireMember()
  if (auth.error) return auth.error
  const { period } = await params
  const statement = await memberStatement(prisma, auth.principal.memberId, period, todayIso())
  return statement ? NextResponse.json(statement) : notFound()
}
