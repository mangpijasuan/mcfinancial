// M8 (docs/architecture/11 §1): every sign-in goes through "User". Staff
// users sign in by email, member users by member ID; an officer who is also
// a member has one of each (D-17). Portal access is a member login, and new
// members get sequential numbers.
import bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it } from 'vitest'
import { TEST_IDS, signInAs, signInAsMember, staffId } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createMember } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { authOptions } from '@/lib/auth'
import { adoptPortalLogins, portalAccess, portalAccessFor } from '@/modules/auth/memberLogins'
import { nextMemberNumber } from '@/modules/membership/numbers'

const signIn = (provider: 'admin' | 'member', creds: Record<string, string>) => {
  const p = authOptions.providers.find((x: any) => (x.options?.id ?? x.id) === provider) as any
  return p.options.authorize(creds, { headers: { 'user-agent': 'vitest', 'x-forwarded-for': '203.0.113.5' } })
}
const access = (id: string, body: Record<string, unknown>) => callRoute('members/[id]/set-password', 'POST', { params: { id }, body })
const loginOf = (memberId: string) => prisma.user.findUniqueOrThrow({ where: { kind_memberId: { kind: 'member', memberId } } })

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
})

describe('member sign-in', () => {
  beforeEach(async () => {
    await createMember('MC-0007', { portalPassword: await bcrypt.hash('member passphrase', 4) })
    await createMember('MC-0008', { portal: false })
  })

  it('goes through the member user, and records the sign-in', async () => {
    const before = await auditMarker()
    expect(await signIn('member', { memberId: 'MC-0007', password: 'member passphrase' })).toMatchObject({ kind: 'member', memberId: 'MC-0007' })
    expect((await loginOf('MC-0007')).lastLoginAt).not.toBeNull()
    expect((await auditEntriesSince(before)).map((a) => a.action)).toEqual(['auth.login.success'])
  })

  it('is refused with a wrong password, without a login, or with access switched off', async () => {
    expect(await signIn('member', { memberId: 'MC-0007', password: 'wrong' })).toBeNull()
    expect(await signIn('member', { memberId: 'MC-0008', password: 'member passphrase' })).toBeNull()
    await prisma.user.update({ where: { kind_memberId: { kind: 'member', memberId: 'MC-0007' } }, data: { disabledAt: new Date() } })
    expect(await signIn('member', { memberId: 'MC-0007', password: 'member passphrase' })).toBeNull()
  })

  it('a member login cannot sign in as staff, or hold staff roles or sessions', async () => {
    const login = await loginOf('MC-0007')
    await expect(prisma.staffRoleAssignment.create({ data: { userId: login.id, role: 'treasurer' } })).rejects.toThrow(/not a staff user/)
    await expect(prisma.staffSession.create({ data: { id: 'x', userId: login.id, expiresAt: new Date(Date.now() + 60_000) } })).rejects.toThrow(/not a staff user/)
    await expect(prisma.mfaRecoveryCode.create({ data: { userId: login.id, codeHash: 'h' } })).rejects.toThrow(/not a staff user/)
    // The staff screens do not see it.
    signInAs('administrator')
    expect((await callRoute('staff', 'GET')).json.staff.map((s: any) => s.id)).not.toContain(login.id)
    for (const route of ['staff/[id]', 'staff/[id]/reset-mfa', 'staff/[id]/revoke-sessions']) {
      const method = route === 'staff/[id]' ? 'PATCH' : 'POST'
      expect((await callRoute(route, method, { params: { id: login.id }, body: { name: 'x' } })).status).toBe(404)
    }
  })
})

describe('an officer who is also a member', () => {
  it('has a staff login and a member login, kept apart (D-17)', async () => {
    signInAs('administrator')
    const res = await callRoute('members/[id]/promote-admin', 'POST', { params: { id: TEST_IDS.member }, body: { password: 'a long staff password', roles: ['finance'] } })
    expect(res.status).toBe(201)
    const logins = await prisma.user.findMany({ where: { memberId: TEST_IDS.member }, orderBy: { kind: 'asc' } })
    expect(logins.map((u) => [u.kind, Boolean(u.email)])).toEqual([['member', false], ['staff', true]])
    signInAs('auditor')
    expect((await callRoute('members/[id]', 'GET', { params: { id: TEST_IDS.member } })).json).toMatchObject({ portalEnabled: true, linkedAdmin: { id: logins[1].id } })
  })
})

describe('portal access', () => {
  beforeEach(() => signInAs('admin'))

  it('starts with a password, ends sessions on a new one, and switches off and on', async () => {
    await createMember('MC-0009', { portal: false })
    expect((await access('MC-0009', { enabled: true })).status).toBe(400) // no password yet
    expect((await access('MC-0009', { enabled: false })).json).toMatchObject({ portalEnabled: false })
    expect(await prisma.user.count({ where: { memberId: 'MC-0009' } })).toBe(0)

    const marker = await auditMarker()
    expect((await access('MC-0009', { password: 'first portal pass' })).json).toMatchObject({ id: 'MC-0009', portalEnabled: true })
    expect(await bcrypt.compare('first portal pass', (await loginOf('MC-0009')).passwordHash)).toBe(true)
    expect((await auditEntriesSince(marker))[0]).toMatchObject({ action: 'member.portal_access.update', before: { portalEnabled: false }, after: { portalEnabled: true }, metadata: { passwordChanged: true } })

    // Switched off: sessions end; switched on again: the same password works.
    signInAsMember('MC-0009', Date.now() - 60_000)
    expect((await callRoute('portal/me', 'GET')).status).toBe(200)
    signInAs('admin')
    expect((await access('MC-0009', { enabled: false })).json.portalEnabled).toBe(false)
    expect((await loginOf('MC-0009')).sessionsValidAfter).not.toBeNull()
    expect((await access('MC-0009', { enabled: false })).json.portalEnabled).toBe(false) // already off
    expect((await access('MC-0009', { enabled: true })).json.portalEnabled).toBe(true)
    expect(await signIn('member', { memberId: 'MC-0009', password: 'first portal pass' })).toBeTruthy()

    // A first password given with access off leaves it off.
    await createMember('MC-0010', { portal: false })
    expect((await access('MC-0010', { password: 'closed portal pass', enabled: false })).json.portalEnabled).toBe(false)
    expect(await portalAccess(prisma, 'MC-0010')).toBe(false)
    expect([...(await portalAccessFor(prisma, ['MC-0009', 'MC-0010']))]).toEqual(['MC-0009'])
  })

  it('leaves access as it is when nothing changes', async () => {
    expect((await access(TEST_IDS.member, {})).json.portalEnabled).toBe(true)
    expect((await loginOf(TEST_IDS.member)).sessionsValidAfter).toBeNull()
  })

  it('refuses what it cannot set', async () => {
    expect((await access(TEST_IDS.member, { password: 'short' })).status).toBe(400)
    expect((await access(TEST_IDS.member, { password: 12345678 })).status).toBe(400)
    expect((await access(TEST_IDS.member, { enabled: 'yes' })).status).toBe(400)
    expect((await access('MC-NOBODY', { password: 'long enough pass' })).status).toBe(404)
    expect((await callRoute('members/[id]/set-password', 'POST', { params: { id: TEST_IDS.member }, rawBody: 'nope' })).status).toBe(400)
    signInAs('finance')
    expect((await access(TEST_IDS.member, { enabled: false })).status).toBe(403)
  })

  it('is read from the login, not the old member fields', async () => {
    await prisma.member.update({ where: { id: TEST_IDS.member }, data: { portalEnabled: false, portalPassword: 'stale' } })
    signInAs('auditor')
    const m = (await callRoute('members/[id]', 'GET', { params: { id: TEST_IDS.member } })).json
    expect(m.portalEnabled).toBe(true)
    expect(m).not.toHaveProperty('portalPassword')
    expect(m).not.toHaveProperty('portalSessionsValidAfter')
  })
})

describe('data loaded the old way', () => {
  it('gets logins from the old portal fields, once', async () => {
    const hash = await bcrypt.hash('legacy portal pass', 4)
    await createMember('MC-0020', { portal: false })
    await prisma.member.update({ where: { id: 'MC-0020' }, data: { portalEnabled: true, portalPassword: hash } })
    await createMember('MC-0021', { portal: false })
    await prisma.member.update({ where: { id: 'MC-0021' }, data: { portalEnabled: false, portalPassword: hash, portalSessionsValidAfter: new Date('2026-09-01') } })

    expect(await adoptPortalLogins(prisma)).toBe(2)
    expect(await adoptPortalLogins(prisma)).toBe(0)
    expect(await loginOf('MC-0020')).toMatchObject({ passwordHash: hash, disabledAt: null })
    expect(await loginOf('MC-0021')).toMatchObject({ passwordHash: hash, sessionsValidAfter: new Date('2026-09-01') })
    expect((await loginOf('MC-0021')).disabledAt).not.toBeNull()
    expect(await signIn('member', { memberId: 'MC-0020', password: 'legacy portal pass' })).toBeTruthy()
  })
})

describe('member numbers', () => {
  it('follow the highest number in use, keeping its width', () => {
    expect(nextMemberNumber([])).toBe('MC-0001')
    expect(nextMemberNumber(['MC-0009', 'MC-0012', 'MC-TEST-A', 'XX-9999'])).toBe('MC-0013')
    expect(nextMemberNumber(['MC-90064', 'MC-0100'])).toBe('MC-90065')
    expect(nextMemberNumber(['MC-9999'])).toBe('MC-10000')
    expect(nextMemberNumber(['MC-12'])).toBe('MC-0013')
  })

  it('are given to new members, one each even when added at the same moment', async () => {
    await createMember('MC-0041')
    signInAs('administrator')
    const add = (legalName: string) => callRoute('members', 'POST', { body: { legalName, joinDate: '2026-10-01' } })
    const [a, b] = await Promise.all([add('New One'), add('New Two')])
    expect([a.json.id, b.json.id].sort()).toEqual(['MC-0042', 'MC-0043'])
    expect((await add('New Three')).json.id).toBe('MC-0044')
  })
})

describe('staff ids carry over', () => {
  it('so approvals and audit entries still name the same people', async () => {
    const treasurer = await prisma.user.findUniqueOrThrow({ where: { id: staffId('treasurer') } })
    expect(treasurer).toMatchObject({ kind: 'staff', email: `${staffId('treasurer')}@example.test` })
  })
})
