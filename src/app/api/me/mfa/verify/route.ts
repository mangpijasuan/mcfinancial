import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { badRequest, readJsonObject } from '@/lib/http'
import { requireStaffSession } from '@/modules/auth'
import { decryptSecret, issueRecoveryCodes, totpStep } from '@/modules/auth/mfa'
import { revokeStaffSessions } from '@/modules/auth/sessions'
import { LIMITS, clearAttempts, isRateLimited, recordFailedAttempt } from '@/lib/rateLimit'
import { auditContext, recordAudit } from '@/modules/audit'

// Step 2 of enrolment: prove the authenticator works. Activates MFA,
// marks this session verified, ends the account's other sessions (they
// were never verified) and returns recovery codes — shown once.
export async function POST(req: NextRequest) {
  const auth = await requireStaffSession()
  if (auth.error) return auth.error
  const principal = auth.principal
  if (principal.mfaEnrolled) {
    return NextResponse.json({ error: 'Two-factor authentication is already set up.' }, { status: 409 })
  }
  const body = await readJsonObject(req)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!/^\d{6}$/.test(code)) return badRequest('Enter the 6-digit code from your authenticator app.')

  const limitKey = `mfa-enrol:${principal.id}`
  if (await isRateLimited(limitKey, LIMITS.mfa)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  const admin = await prisma.user.findUniqueOrThrow({ where: { id: principal.id } })
  if (!admin.mfaPendingSecret) return badRequest('Start the setup first.')
  const step = totpStep(decryptSecret(admin.mfaPendingSecret), code)
  if (step === null) {
    await recordFailedAttempt(limitKey)
    return badRequest('That code did not match. Check the time on your phone and try the newest code.')
  }
  await clearAttempts(limitKey)

  const recoveryCodes = await prisma.$transaction(async (tx) => {
    const activated = await tx.user.updateMany({
      where: { id: principal.id, mfaEnabledAt: null, mfaPendingSecret: admin.mfaPendingSecret },
      data: { mfaSecret: admin.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastUsedStep: step },
    })
    if (activated.count !== 1) return null
    const codes = await issueRecoveryCodes(tx, principal.id)
    await tx.staffSession.update({ where: { id: principal.sessionId }, data: { mfaVerifiedAt: new Date() } })
    const revoked = await revokeStaffSessions(tx, principal.id, 'mfa_enrolled', principal.sessionId)
    await recordAudit(tx, auditContext(req, principal), {
      action: 'staff.mfa.enrol', entityType: 'admin', entityId: principal.id, metadata: { otherSessionsRevoked: revoked },
    })
    return codes
  })
  if (!recoveryCodes) {
    return NextResponse.json({ error: 'Two-factor authentication is already set up.' }, { status: 409 })
  }
  return NextResponse.json({ recoveryCodes })
}
