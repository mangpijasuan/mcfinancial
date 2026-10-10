import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireMember } from '@/modules/auth'
import { readZelleQr, zelleRecipient } from '@/lib/zelle'
import { quickBooksStatus, syncAchPayments } from '@/modules/payments/quickbooks'

export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error
  const memberId = auth.principal.memberId

  // A member coming back from QuickBooks sees their bank payment as soon as
  // QuickBooks has it. At most once a minute per payment; never blocks the page.
  await syncAchPayments({ memberId, staleAfterMs: 60_000 }).catch((err) => console.error('QuickBooks check failed:', err?.message ?? err))

  const payments = await prisma.portalPayment.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
    take: 25,
  })

  return NextResponse.json({ payments, zelle: zelleRecipient(), zelleQr: readZelleQr() !== null, ach: (await quickBooksStatus()).ready })
}
