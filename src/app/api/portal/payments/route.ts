import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireMember } from '@/modules/auth'
import { readZelleQr, zelleRecipient } from '@/lib/zelle'

export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error
  const memberId = auth.principal.memberId

  const payments = await prisma.portalPayment.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
    take: 25,
  })

  return NextResponse.json({ payments, zelle: zelleRecipient(), zelleQr: readZelleQr() !== null })
}
