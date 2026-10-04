// Reset (or create) a staff account's password without a hard-coded
// default. Break-glass for lockouts: run it from the server shell.
//
//   ADMIN_EMAIL_TO_RESET=admin@mcfinancial.local \
//   NEW_ADMIN_PASSWORD='a long passphrase' \
//   [RESET_MFA=1] \
//   npm run admin:reset-password
//
// RESET_MFA=1 also clears two-factor authentication (lost phone and lost
// recovery codes); the person enrols again at their next sign-in. Every
// session of the account is ended. A new account is created as Super Admin.
// The password is read from the environment so it never lands in shell
// history as an argument, and it is never printed.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const MIN_LENGTH = 12

async function main() {
  const email = process.env.ADMIN_EMAIL_TO_RESET?.trim().toLowerCase()
  const password = process.env.NEW_ADMIN_PASSWORD
  const resetMfa = process.env.RESET_MFA === '1'

  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL_TO_RESET and NEW_ADMIN_PASSWORD.')
  }
  if (password.length < MIN_LENGTH) {
    throw new Error(`NEW_ADMIN_PASSWORD must be at least ${MIN_LENGTH} characters.`)
  }

  const prisma = new PrismaClient()
  try {
    const hashed = await bcrypt.hash(password, 10)
    const existing = await prisma.user.findUnique({ where: { email } })
    // Recorded in the audit log like any other change (system actor).
    const audit = (action: string, entityId: string) => ({
      actorType: 'system', actorLabel: 'cli:reset-admin-password',
      action, entityType: 'admin', entityId, metadata: { email, passwordChanged: true, mfaReset: resetMfa },
    })
    if (existing) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { email },
          data: {
            passwordHash: hashed,
            ...(resetMfa ? { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null } : {}),
          },
        })
        if (resetMfa) await tx.mfaRecoveryCode.deleteMany({ where: { userId: existing.id } })
        await tx.staffSession.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'cli_reset' },
        })
        await tx.auditLog.create({ data: audit('admin.password.reset', existing.id) })
      })
      console.log(`Password updated for ${email}${resetMfa ? '; two-factor authentication cleared' : ''}. All sessions ended.`)
    } else {
      await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { kind: 'staff', email, name: 'Millionaires Club Admin', passwordHash: hashed } })
        await tx.staffRoleAssignment.create({ data: { userId: created.id, role: 'super_admin' } })
        await tx.auditLog.create({ data: audit('admin.create', created.id) })
      })
      console.log(`Created Super Admin ${email}. Two-factor setup happens at first sign-in.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
