import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { notFound } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { statementPeriods } from '@/modules/accounting/statements'

// The periods a member's statement can cover, for staff answering a member's question.
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('members.read')
  if (auth.error) return auth.error
  const { id } = await params
  if (!(await prisma.member.findUnique({ where: { id }, select: { id: true } }))) return notFound()
  return NextResponse.json({ periods: await statementPeriods(prisma, todayIso()) })
}
