import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaff } from '@/modules/auth'
import { revokeStaffSessions } from '@/modules/auth/sessions'
import { auditContext, recordAudit } from '@/modules/audit'

// Your own active sessions (devices), and "sign out everywhere else".
export async function GET() {
  const auth = await requireStaff()
  if (auth.error) return auth.error
  const rows = await prisma.staffSession.findMany({
    where: { userId: auth.principal.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true },
  })
  return NextResponse.json({
    sessions: rows.map((s) => ({
      current: s.id === auth.principal.sessionId,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      ip: s.ip,
      userAgent: s.userAgent,
    })),
  })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireStaff()
  if (auth.error) return auth.error
  const revoked = await prisma.$transaction(async (tx) => {
    const count = await revokeStaffSessions(tx, auth.principal.id, 'signed_out_elsewhere', auth.principal.sessionId)
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.sessions.revoke_others', entityType: 'admin', entityId: auth.principal.id,
      metadata: { sessionsRevoked: count },
    })
    return count
  })
  return NextResponse.json({ revoked })
}
