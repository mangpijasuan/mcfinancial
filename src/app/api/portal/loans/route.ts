import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { requireMember } from '@/modules/auth'
import { memberLoans } from '@/modules/loans/memberView'

// "My loan": the signed-in member's own loans, and the loans they co-sign.
export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error
  return NextResponse.json(await memberLoans(prisma, auth.principal.memberId, todayIso()))
}
