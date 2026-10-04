import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { historyReview } from '@/modules/loans/history'

// M9: older loans still to link to members, and those marked Active whose
// balance the Treasurer has yet to confirm.
export async function GET() {
  const auth = await requirePermission('loans.read')
  if (auth.error) return auth.error
  return NextResponse.json(await prisma.$transaction((tx) => historyReview(tx)))
}
