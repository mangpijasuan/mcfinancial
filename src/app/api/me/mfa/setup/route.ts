import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { requireStaffSession } from '@/modules/auth'
import { encryptSecret, newTotpEnrolment } from '@/modules/auth/mfa'
import { auditContext, recordAudit } from '@/modules/audit'

// Step 1 of enrolment: a new secret, shown once as a QR code (and as text
// for manual entry). It only becomes active after a code is verified.
export async function POST(req: NextRequest) {
  const auth = await requireStaffSession()
  if (auth.error) return auth.error
  if (auth.principal.mfaEnrolled) {
    return NextResponse.json({ error: 'Two-factor authentication is already set up.' }, { status: 409 })
  }

  const { secret, uri } = newTotpEnrolment(auth.principal.email)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: auth.principal.id }, data: { mfaPendingSecret: encryptSecret(secret) } })
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'staff.mfa.setup_started', entityType: 'admin', entityId: auth.principal.id,
    })
  })

  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 })
  return NextResponse.json({ secret, uri, qrDataUrl })
}
