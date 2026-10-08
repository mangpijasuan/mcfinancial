import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'

export async function GET(req: NextRequest) {
  const auth = await requirePermission('payments.read')
  if (auth.error) return auth.error

  const s = new URL(req.url).searchParams
  const status = s.get('status') || ''

  const where: any = {}
  if (status) where.status = status

  const payments = await prisma.portalPayment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { member: { select: { legalName: true } } },
  })

  // Claims whose confirmation is waiting for a second approver (D-06).
  const pending = await prisma.approvalRequest.findMany({
    where: { status: 'pending', entityType: 'portal_payment', entityId: { in: payments.map((p) => p.id) } },
    select: { entityId: true, publicId: true },
  })
  const awaiting = new Map(pending.map((r) => [r.entityId, r.publicId]))
  const stripeIssues = await prisma.stripeWebhookEvent.findMany({ where: { status: { in: ['failed', 'review'] } }, orderBy: { updatedAt: 'desc' }, take: 100, select: { eventId: true, type: true, status: true, attempts: true, lastError: true, updatedAt: true } })
  return NextResponse.json({ stripeIssues, payments: payments.map((p) => ({ ...p, awaitingApproval: awaiting.get(p.id) ?? null })) })
}
