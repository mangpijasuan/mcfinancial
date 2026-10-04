import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { badRequest, readJsonObject } from '@/lib/http'
import { requireStaff } from '@/modules/auth'
import { issueRecoveryCodes, verifySecondFactor } from '@/modules/auth/mfa'
import { LIMITS, clearAttempts, isRateLimited, recordFailedAttempt } from '@/lib/rateLimit'
import { auditContext, recordAudit } from '@/modules/audit'

// New recovery codes (old ones stop working). Needs a current
// authenticator code, so a stolen session alone cannot mint codes.
export async function POST(req: NextRequest) {
  const auth = await requireStaff()
  if (auth.error) return auth.error
  const body = await readJsonObject(req)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!/^\d{6}$/.test(code)) return badRequest('Enter the 6-digit code from your authenticator app.')

  const limitKey = `mfa:${auth.principal.id}`
  if (await isRateLimited(limitKey, LIMITS.mfa)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: auth.principal.id } })
  const result = await verifySecondFactor(prisma, admin, code)
  if (!result.ok) {
    await recordFailedAttempt(limitKey)
    return badRequest('That code did not match.')
  }
  await clearAttempts(limitKey)

  const recoveryCodes = await prisma.$transaction(async (tx) => {
    const codes = await issueRecoveryCodes(tx, auth.principal.id)
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.mfa.recovery_codes.regenerate', entityType: 'admin', entityId: auth.principal.id,
    })
    return codes
  })
  return NextResponse.json({ recoveryCodes })
}
