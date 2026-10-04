import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { revokeStaffSessions } from '@/modules/auth/sessions'
import { auditContext, recordAudit } from '@/modules/audit'
import { checkCanManage, staffDto, staffSelect } from '@/modules/staff'

// For a lost phone: clears the account's authenticator and recovery codes
// and signs it out everywhere; the person enrols again at next sign-in.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('staff.manage')
  if (auth.error) return auth.error

  const { id } = await params
  const target = await prisma.user.findFirst({ where: { id, kind: 'staff' }, select: staffSelect })
  if (!target) return notFound('Staff account not found.')
  const denied = checkCanManage(auth.principal, { id, roles: target.roles.map((r) => r.role) })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null },
    })
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: id } })
    const revoked = await revokeStaffSessions(tx, id, 'mfa_reset')
    const after = await tx.user.findUniqueOrThrow({ where: { id }, select: staffSelect })
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.mfa.reset', entityType: 'admin', entityId: id,
      before: staffDto(target), after: staffDto(after), metadata: { sessionsRevoked: revoked },
    })
    return after
  })
  return NextResponse.json(staffDto(updated))
}
