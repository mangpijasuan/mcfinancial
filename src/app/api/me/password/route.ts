import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { badRequest, readJsonObject } from '@/lib/http'
import { requireStaff } from '@/modules/auth'
import { revokeStaffSessions } from '@/modules/auth/sessions'
import { LIMITS, clearAttempts, isRateLimited, recordFailedAttempt } from '@/lib/rateLimit'
import { auditContext, recordAudit } from '@/modules/audit'
import { STAFF_PASSWORD_MIN_LENGTH } from '@/modules/staff'

// Change your own password. Other sessions are signed out.
export async function POST(req: NextRequest) {
  const auth = await requireStaff()
  if (auth.error) return auth.error
  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const next = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (next.length < STAFF_PASSWORD_MIN_LENGTH) {
    return badRequest(`New password must be at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`)
  }

  const limitKey = `password-change:${auth.principal.id}`
  if (await isRateLimited(limitKey, LIMITS.account)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: auth.principal.id } })
  if (!(await bcrypt.compare(current, admin.passwordHash))) {
    await recordFailedAttempt(limitKey)
    return badRequest('Your current password is not correct.')
  }
  await clearAttempts(limitKey)

  const hashed = await bcrypt.hash(next, 10)
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash: hashed } })
    const count = await revokeStaffSessions(tx, admin.id, 'password_changed', auth.principal.sessionId)
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.password.change', entityType: 'admin', entityId: admin.id,
      metadata: { passwordChanged: true, otherSessionsRevoked: count },
    })
    return count
  })
  return NextResponse.json({ ok: true, otherSessionsRevoked: revoked })
}
