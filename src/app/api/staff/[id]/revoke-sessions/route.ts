import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { revokeStaffSessions } from '@/modules/auth/sessions'
import { auditContext, recordAudit } from '@/modules/audit'
import { checkCanManage, staffSelect } from '@/modules/staff'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('staff.manage')
  if (auth.error) return auth.error

  const { id } = await params
  const target = await prisma.user.findFirst({ where: { id, kind: 'staff' }, select: staffSelect })
  if (!target) return notFound('Staff account not found.')
  const denied = checkCanManage(auth.principal, { id, roles: target.roles.map((r) => r.role) })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const revoked = await prisma.$transaction(async (tx) => {
    const count = await revokeStaffSessions(tx, id, 'revoked_by_admin')
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.sessions.revoke', entityType: 'admin', entityId: id, metadata: { sessionsRevoked: count },
    })
    return count
  })
  return NextResponse.json({ revoked })
}
