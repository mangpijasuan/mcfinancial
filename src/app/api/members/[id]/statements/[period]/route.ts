import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { notFound } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { memberStatement } from '@/modules/accounting/statements'

// A member's statement, exactly as the member sees it in the portal.
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string; period: string }> }) {
  const auth = await requirePermission('members.read')
  if (auth.error) return auth.error
  const { id, period } = await params
  const statement = await memberStatement(prisma, id, period, todayIso())
  return statement ? NextResponse.json(statement) : notFound()
}
