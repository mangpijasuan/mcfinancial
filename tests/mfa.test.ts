// TOTP multi-factor authentication: sign-in, replay protection, recovery
// codes, enrolment and secret encryption.
import { beforeEach, describe, expect, it } from 'vitest'
import { signInWithStaffSession } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { TEST_STAFF_PASSWORD, TEST_TOTP_SECRET, createSession, createStaff } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { authOptions } from '@/lib/auth'
import { currentTotp, decryptSecret, encryptSecret, issueRecoveryCodes } from '@/modules/auth/mfa'
import { hashSessionToken } from '@/modules/auth/sessions'

const authorize = (creds: Record<string, string>) => {
  const provider = authOptions.providers.find((p: any) => (p.options?.id ?? p.id) === 'admin') as any
  return provider.options.authorize(creds, { headers: { 'user-agent': 'vitest', 'x-forwarded-for': '198.51.100.9' } })
}

let n = 0
/** A fresh account per test keeps the in-memory login rate limiter out of the way. */
async function staff(roles: string[], mfa = true) {
  const id = `mfa-staff-${++n}`
  await createStaff(id, roles, { mfa })
  return { id, email: `${id}@example.test` }
}

beforeEach(async () => {
  await resetDatabase()
})

describe('secret encryption', () => {
  it('round-trips and detects tampering', () => {
    const stored = encryptSecret(TEST_TOTP_SECRET)
    expect(stored).not.toContain(TEST_TOTP_SECRET)
    expect(decryptSecret(stored)).toBe(TEST_TOTP_SECRET)
    const [v, iv, tag, data] = stored.split(':')
    const flipped = Buffer.from(data, 'base64'); flipped[0] ^= 1
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })

  it('refuses to run without a proper key', () => {
    const key = process.env.MFA_ENCRYPTION_KEY
    process.env.MFA_ENCRYPTION_KEY = 'too-short'
    try {
      expect(() => encryptSecret('x')).toThrow(/MFA_ENCRYPTION_KEY/)
    } finally {
      process.env.MFA_ENCRYPTION_KEY = key
    }
  })
})

describe('staff sign-in with MFA', () => {
  it('asks for a code after a correct password, and not before', async () => {
    const s = await staff(['finance'])
    expect(await authorize({ email: s.email, password: 'wrong password!!' })).toBeNull()
    await expect(authorize({ email: s.email, password: TEST_STAFF_PASSWORD })).rejects.toThrow('MFA_REQUIRED')
  })

  it('signs in with a valid code and creates a verified session', async () => {
    const s = await staff(['finance'])
    const user = await authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code: currentTotp(TEST_TOTP_SECRET) })
    expect(user).toMatchObject({ id: s.id, kind: 'staff' })
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: hashSessionToken(user.sid) } })
    expect(row.mfaVerifiedAt).not.toBeNull()
    expect(row).toMatchObject({ ip: '198.51.100.9', userAgent: 'vitest' })
  })

  it('refuses a wrong code and records the attempt', async () => {
    const s = await staff(['finance'])
    const marker = await auditMarker()
    await expect(authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code: '000000' })).rejects.toThrow('MFA_INVALID')
    const entries = await auditEntriesSince(marker)
    expect(entries.map((e) => e.action)).toContain('auth.mfa.failure')
    expect(await prisma.staffSession.count({ where: { userId: s.id } })).toBe(0)
  })

  it('accepts each code only once', async () => {
    const s = await staff(['finance'])
    const code = currentTotp(TEST_TOTP_SECRET)
    expect(await authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code })).toBeTruthy()
    await expect(authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code })).rejects.toThrow('MFA_INVALID')
  })

  it('accepts a recovery code once', async () => {
    const s = await staff(['finance'])
    const [code] = await issueRecoveryCodes(prisma, s.id)
    expect(await authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code: code.toUpperCase() })).toBeTruthy()
    await expect(authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code })).rejects.toThrow('MFA_INVALID')
  })

  it('lets a not-yet-enrolled account in only as far as enrolment', async () => {
    const s = await staff(['finance'], false)
    const user = await authorize({ email: s.email, password: TEST_STAFF_PASSWORD })
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: hashSessionToken(user.sid) } })
    expect(row.mfaVerifiedAt).toBeNull()
  })

  it('refuses a disabled account even with the right password', async () => {
    const s = await staff(['finance'])
    await prisma.user.update({ where: { id: s.id }, data: { disabledAt: new Date() } })
    expect(await authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code: currentTotp(TEST_TOTP_SECRET) })).toBeNull()
  })

  it('flags Super Admin sign-ins as break-glass', async () => {
    const s = await staff(['super_admin'])
    const marker = await auditMarker()
    await authorize({ email: s.email, password: TEST_STAFF_PASSWORD, code: currentTotp(TEST_TOTP_SECRET) })
    const success = (await auditEntriesSince(marker)).find((e) => e.action === 'auth.login.success')
    expect(success?.metadata).toMatchObject({ breakGlass: true, mfa: 'totp' })
  })

  it('puts identity, not roles, into the session', async () => {
    const token = await authOptions.callbacks!.jwt!({ token: { sub: 'x' }, user: { id: 'x', kind: 'staff', sid: 'abc' } as any } as any)
    const session = await authOptions.callbacks!.session!({ session: { user: {}, expires: '' }, token } as any) as any
    expect(session.user).toMatchObject({ id: 'x', kind: 'staff', sid: 'abc' })
    expect(session.user).not.toHaveProperty('adminRole')
    expect(session.user).not.toHaveProperty('permissions')
  })
})

describe('enrolment', () => {
  async function pendingSession() {
    const s = await staff(['finance'], false)
    await createSession(s.id, `${s.id}-token`, { mfaVerified: false })
    await createSession(s.id, `${s.id}-other`, { mfaVerified: false })
    signInWithStaffSession(s.id, `${s.id}-token`)
    return s
  }

  it('activates MFA only after a correct code, then returns recovery codes once', async () => {
    const s = await pendingSession()
    const setup = await callRoute('me/mfa/setup', 'POST')
    expect(setup.status).toBe(200)
    expect(setup.json.uri).toMatch(/^otpauth:\/\/totp\//)
    expect(setup.json.qrDataUrl).toMatch(/^data:image\/png;base64,/)

    expect((await callRoute('me/mfa/verify', 'POST', { body: { code: '000000' } })).status).toBe(400)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).mfaEnabledAt).toBeNull()

    const verify = await callRoute('me/mfa/verify', 'POST', { body: { code: currentTotp(setup.json.secret) } })
    expect(verify.status).toBe(200)
    expect(verify.json.recoveryCodes).toHaveLength(10)

    const admin = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    expect(admin.mfaEnabledAt).not.toBeNull()
    expect(admin.mfaSecret).not.toContain(setup.json.secret)
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: s.id } })).toBe(10)

    // This session is now verified; the other (unverified) one was ended.
    expect((await callRoute('me', 'GET')).json.mfaVerified).toBe(true)
    const other = await prisma.staffSession.findUniqueOrThrow({ where: { id: hashSessionToken(`${s.id}-other`) } })
    expect(other.revokedReason).toBe('mfa_enrolled')

    // And it cannot be re-run to swap in an attacker's authenticator.
    expect((await callRoute('me/mfa/setup', 'POST')).status).toBe(409)
  })

  it('regenerating recovery codes needs a current authenticator code', async () => {
    const s = await staff(['finance'])
    await createSession(s.id, `${s.id}-token`)
    signInWithStaffSession(s.id, `${s.id}-token`)
    expect((await callRoute('me/mfa/recovery-codes', 'POST', { body: { code: '000000' } })).status).toBe(400)
    const ok = await callRoute('me/mfa/recovery-codes', 'POST', { body: { code: currentTotp(TEST_TOTP_SECRET) } })
    expect(ok.status).toBe(200)
    expect(ok.json.recoveryCodes).toHaveLength(10)
  })
})

describe('own password', () => {
  it('needs the current password and signs out other sessions', async () => {
    const s = await staff(['finance'])
    await createSession(s.id, `${s.id}-here`)
    await createSession(s.id, `${s.id}-laptop`)
    signInWithStaffSession(s.id, `${s.id}-here`)
    expect((await callRoute('me/password', 'POST', { body: { currentPassword: 'nope', newPassword: 'another long passphrase' } })).status).toBe(400)
    const ok = await callRoute('me/password', 'POST', { body: { currentPassword: TEST_STAFF_PASSWORD, newPassword: 'another long passphrase' } })
    expect(ok.json).toMatchObject({ ok: true, otherSessionsRevoked: 1 })
    expect((await callRoute('me', 'GET')).status).toBe(200)
  })
})
