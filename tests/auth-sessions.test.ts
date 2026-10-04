// Database-backed sessions (D-07, S-1): revocation, disabling and role
// changes take effect on the very next request; staff sessions end after
// 30 idle minutes or 12 hours; member sessions end when portal access
// is switched off or the password changes.
import { beforeEach, describe, expect, it } from 'vitest'
import { TEST_IDS, signInAs, signInAsMember, signInWithStaffSession, staffId } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createSession, createStaff } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { hashSessionToken } from '@/modules/auth/sessions'

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
})

const listContributions = () => callRoute('contributions', 'GET')

describe('staff sessions', () => {
  it('a removed role stops working on the next request', async () => {
    signInAs('finance')
    expect((await listContributions()).status).toBe(200)
    await prisma.staffRoleAssignment.deleteMany({ where: { userId: staffId('finance') } })
    expect((await listContributions()).status).toBe(403)
  })

  it('a disabled account is locked out at once', async () => {
    signInAs('finance')
    await prisma.user.update({ where: { id: staffId('finance') }, data: { disabledAt: new Date() } })
    expect((await listContributions()).status).toBe(401)
  })

  it('a revoked session is refused', async () => {
    signInAs('finance')
    await prisma.staffSession.update({ where: { id: hashSessionToken('sid-finance') }, data: { revokedAt: new Date() } })
    expect((await listContributions()).status).toBe(401)
  })

  it('ends after 30 minutes idle, and records why', async () => {
    await createStaff('idle-staff', ['finance'])
    await createSession('idle-staff', 'idle-token', { lastSeenAt: new Date(Date.now() - 31 * 60 * 1000) })
    signInWithStaffSession('idle-staff', 'idle-token')
    expect((await listContributions()).status).toBe(401)
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: hashSessionToken('idle-token') } })
    expect(row.revokedReason).toBe('idle')
  })

  it('ends at the 12-hour limit even when active', async () => {
    await createStaff('old-staff', ['finance'])
    await createSession('old-staff', 'old-token', { expiresAt: new Date(Date.now() - 1000) })
    signInWithStaffSession('old-staff', 'old-token')
    expect((await listContributions()).status).toBe(401)
  })

  it('keeps an active session alive by recording activity', async () => {
    await createStaff('busy-staff', ['finance'])
    await createSession('busy-staff', 'busy-token', { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) })
    signInWithStaffSession('busy-staff', 'busy-token')
    expect((await listContributions()).status).toBe(200)
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: hashSessionToken('busy-token') } })
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(5000)
  })

  it('rejects a session token presented for another account', async () => {
    signInWithStaffSession(staffId('super_admin'), 'sid-finance')
    expect((await listContributions()).status).toBe(401)
  })

  it('blocks everything but enrolment until MFA is verified', async () => {
    signInAs('staff_mfa_pending')
    const res = await listContributions()
    expect(res.status).toBe(403)
    expect(res.json.code).toBe('MFA_REQUIRED')
    const me = await callRoute('me', 'GET')
    expect(me.status).toBe(200)
    expect(me.json).toMatchObject({ mfaEnrolled: false, mfaVerified: false, permissions: [] })
  })
})

describe('member sessions', () => {
  it('end when portal access is switched off', async () => {
    signInAsMember(TEST_IDS.member)
    expect((await callRoute('portal/me', 'GET')).status).toBe(200)
    signInAs('admin')
    expect((await callRoute('members/[id]/set-password', 'POST', { params: { id: TEST_IDS.member }, body: { enabled: false } })).json.portalEnabled).toBe(false)
    signInAsMember(TEST_IDS.member)
    expect((await callRoute('portal/me', 'GET')).status).toBe(401)
  })

  it('end when an admin sets a new portal password', async () => {
    signInAsMember(TEST_IDS.member, Date.now() - 60_000)
    signInAs('admin')
    const res = await callRoute('members/[id]/set-password', 'POST', { params: { id: TEST_IDS.member }, body: { password: 'new portal pass' } })
    expect(res.status).toBe(200)
    signInAsMember(TEST_IDS.member, Date.now() - 60_000)
    expect((await callRoute('portal/me', 'GET')).status).toBe(401)
    signInAsMember(TEST_IDS.member, Date.now() + 1000) // signed in again afterwards
    expect((await callRoute('portal/me', 'GET')).status).toBe(200)
  })
})
