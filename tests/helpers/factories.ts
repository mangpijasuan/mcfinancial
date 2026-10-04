import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { hashSessionToken, STAFF_SESSION_MAX_AGE_MS } from '@/modules/auth/sessions'
import { encryptSecret } from '@/modules/auth/mfa'
import { STAFF_ACTORS, TEST_IDS, staffEmail, staffId, staffSid, type StaffActor } from './actors'

// Synthetic fixtures only — never real member data in tests (S-7).

/** A fixed TOTP secret for fixture accounts (base32). */
export const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

const TEST_MEMBER_PASSWORD_HASH = bcrypt.hashSync('test member password', 4)

/**
 * A member with a portal login (M8), on unless `portalEnabled: false`;
 * `portalPassword` sets the login's hash; `portal: false` makes no login.
 */
export async function createMember(id: string, overrides: Record<string, unknown> = {}) {
  const { portal, portalEnabled, portalPassword, ...data } = overrides
  const member = await prisma.member.create({
    data: {
      id,
      legalName: `Test Member ${id}`,
      joinDate: new Date('2024-01-01'),
      status: 'Active',
      email: `${id.toLowerCase()}@example.test`,
      ...data,
    },
  })
  if (portal !== false) {
    await prisma.user.create({
      data: {
        kind: 'member', memberId: id, name: member.legalName,
        passwordHash: (portalPassword as string | undefined) ?? TEST_MEMBER_PASSWORD_HASH,
        disabledAt: portalEnabled === false ? new Date() : null,
      },
    })
  }
  return member
}

export const TEST_STAFF_PASSWORD = 'correct horse battery staple'

/** A staff account with the given roles; MFA enrolled unless told otherwise. */
export async function createStaff(id: string, roles: string[], opts: { mfa?: boolean; email?: string } = {}) {
  const mfa = opts.mfa ?? true
  return prisma.user.create({
    data: {
      id,
      kind: 'staff',
      email: opts.email ?? `${id}@example.test`,
      name: id,
      passwordHash: await bcrypt.hash(TEST_STAFF_PASSWORD, 4),
      mfaSecret: mfa ? encryptSecret(TEST_TOTP_SECRET) : null,
      mfaEnabledAt: mfa ? new Date() : null,
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
}

/** A session row for a token; MFA-verified unless told otherwise. */
export async function createSession(userId: string, token: string, opts: { mfaVerified?: boolean; lastSeenAt?: Date; expiresAt?: Date } = {}) {
  const now = new Date()
  return prisma.staffSession.create({
    data: {
      id: hashSessionToken(token),
      userId,
      mfaVerifiedAt: opts.mfaVerified ?? true ? now : null,
      lastSeenAt: opts.lastSeenAt ?? now,
      expiresAt: opts.expiresAt ?? new Date(now.getTime() + STAFF_SESSION_MAX_AGE_MS),
    },
  })
}

function rolesFor(actor: StaffActor): string[] {
  if (actor === 'staff_no_roles') return []
  if (actor === 'staff_mfa_pending') return ['club_officer']
  return [actor]
}

/** One staff account + live session per role, plus the two edge actors. */
export async function createStaffFixtures() {
  for (const actor of STAFF_ACTORS) {
    const pending = actor === 'staff_mfa_pending'
    await createStaff(staffId(actor), rolesFor(actor), { mfa: !pending, email: staffEmail(actor) })
    await createSession(staffId(actor), staffSid(actor), { mfaVerified: !pending })
  }
}

export async function createLoan(loanId: string, borrowerId: string, overrides: Record<string, unknown> = {}) {
  return prisma.loan.create({
    data: {
      loanId,
      borrowerId,
      borrowerName: `Test Member ${borrowerId}`,
      loanDate: new Date('2026-01-15'),
      termMonths: 10,
      loanAmount: 1000,
      monthlyDue: 100,
      balanceRemaining: 1000,
      status: 'Active',
      ...overrides,
    },
  })
}

/**
 * A bank balance the Treasurer recorded (Gate #1 A10): without one the
 * lending capacity is unknown and no loan can be approved.
 */
export async function recordBankBalance(balanceCents: number, statementDate = '2026-01-01') {
  return prisma.treasuryBankBalance.create({
    data: {
      balanceId: `BB-TEST-${statementDate}-${balanceCents}`,
      statementDate: new Date(`${statementDate}T00:00:00.000Z`),
      balanceCents: BigInt(balanceCents),
      recordedBy: 'test',
    },
  })
}

/** Two members with portal access, staff for every role, and a loan each. */
export async function createBaseFixtures() {
  await createMember(TEST_IDS.member)
  await createMember(TEST_IDS.otherMember)
  await createStaffFixtures()
  await createLoan('LN-TEST-A', TEST_IDS.member)
  await createLoan('LN-TEST-B', TEST_IDS.otherMember)
}
