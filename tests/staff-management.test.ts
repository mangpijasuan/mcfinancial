// Staff & roles: who may grant what, and every change takes effect at once.
import { beforeEach, describe, expect, it } from 'vitest'
import { TEST_IDS, signInAs, staffId } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures } from './helpers/factories'
import { callRoute } from './helpers/routes'

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
})

const newStaff = (roles: string[]) => ({ name: 'New Officer', email: 'new.officer@example.test', password: 'a long temporary pass', roles })

describe('granting roles', () => {
  it('an Administrator can add a Finance officer', async () => {
    signInAs('administrator')
    const res = await callRoute('staff', 'POST', { body: newStaff(['finance']) })
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ roles: ['finance'], mfaEnabled: false, disabled: false })
    expect(res.json).not.toHaveProperty('password')
  })

  it('only a Super Admin can grant Super Admin', async () => {
    signInAs('administrator')
    expect((await callRoute('staff', 'POST', { body: newStaff(['super_admin']) })).status).toBe(403)
    expect((await callRoute('staff/[id]', 'PATCH', { params: { id: staffId('finance') }, body: { roles: ['super_admin'] } })).status).toBe(403)
    signInAs('super_admin')
    expect((await callRoute('staff/[id]', 'PATCH', { params: { id: staffId('finance') }, body: { roles: ['finance', 'super_admin'] } })).status).toBe(200)
  })

  it('an Administrator cannot touch a Super Admin account', async () => {
    signInAs('administrator')
    for (const [route, body] of [['staff/[id]', { password: 'hijack the account!!' }], ['staff/[id]/reset-mfa', undefined], ['staff/[id]/revoke-sessions', undefined]] as const) {
      const method = route === 'staff/[id]' ? 'PATCH' : 'POST'
      expect((await callRoute(route, method, { params: { id: TEST_IDS.superAdmin }, body })).status).toBe(403)
    }
  })

  it('nobody changes their own roles, password or status here', async () => {
    signInAs('super_admin')
    expect((await callRoute('staff/[id]', 'PATCH', { params: { id: TEST_IDS.superAdmin }, body: { roles: [] } })).status).toBe(409)
    expect((await callRoute('staff/[id]', 'PATCH', { params: { id: TEST_IDS.superAdmin }, body: { disabled: true } })).status).toBe(409)
    signInAs('administrator')
    expect((await callRoute('staff/[id]', 'PATCH', { params: { id: staffId('administrator') }, body: { roles: ['administrator', 'treasurer'] } })).status).toBe(409)
  })

  it('rejects unknown roles', async () => {
    signInAs('administrator')
    expect((await callRoute('staff/[id]', 'PATCH', { params: { id: staffId('finance') }, body: { roles: ['god_mode'] } })).status).toBe(400)
  })

  it('a role change applies on the target’s next request, and is audited', async () => {
    const marker = await auditMarker()
    signInAs('administrator')
    await callRoute('staff/[id]', 'PATCH', { params: { id: staffId('finance') }, body: { roles: ['auditor'] } })
    signInAs('finance') // the finance account, now an auditor
    expect((await callRoute('contributions', 'POST', { body: {} })).status).toBe(403)
    expect((await callRoute('audit', 'GET')).status).toBe(200)
    const [entry] = await auditEntriesSince(marker)
    expect(entry).toMatchObject({ action: 'staff.roles.update', actorId: staffId('administrator'), entityId: staffId('finance') })
    expect((entry.before as any).roles).toEqual(['finance'])
    expect((entry.after as any).roles).toEqual(['auditor'])
  })
})

describe('account controls', () => {
  it('disabling signs the person out everywhere', async () => {
    signInAs('administrator')
    expect((await callRoute('staff/[id]', 'PATCH', { params: { id: staffId('finance') }, body: { disabled: true } })).status).toBe(200)
    signInAs('finance')
    expect((await callRoute('contributions', 'GET')).status).toBe(401)
    expect(await prisma.staffSession.count({ where: { userId: staffId('finance'), revokedAt: null } })).toBe(0)
  })

  it('a password reset ends existing sessions', async () => {
    signInAs('administrator')
    await callRoute('staff/[id]', 'PATCH', { params: { id: staffId('finance') }, body: { password: 'a fresh long password' } })
    signInAs('finance')
    expect((await callRoute('contributions', 'GET')).status).toBe(401)
  })

  it('an MFA reset clears the authenticator and recovery codes', async () => {
    await prisma.mfaRecoveryCode.create({ data: { userId: staffId('finance'), codeHash: 'x' } })
    signInAs('administrator')
    const res = await callRoute('staff/[id]/reset-mfa', 'POST', { params: { id: staffId('finance') } })
    expect(res.json).toMatchObject({ mfaEnabled: false })
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: staffId('finance') } })
    expect(admin).toMatchObject({ mfaSecret: null, mfaEnabledAt: null })
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: staffId('finance') } })).toBe(0)
    signInAs('finance')
    expect((await callRoute('contributions', 'GET')).status).toBe(401)
  })

  it('never lists secrets', async () => {
    signInAs('auditor')
    const res = await callRoute('staff', 'GET')
    expect(res.status).toBe(200)
    const text = JSON.stringify(res.json)
    expect(text).not.toMatch(/password|mfaSecret|\$2[aby]\$/)
    expect(res.json.roles.map((r: any) => r.key)).toContain('treasurer')
  })

  it('links a staff account to a member with chosen roles', async () => {
    signInAs('administrator')
    const res = await callRoute('members/[id]/promote-admin', 'POST', {
      params: { id: TEST_IDS.otherMember }, body: { password: 'a long temporary pass', roles: ['loan_officer'] },
    })
    expect(res.status).toBe(201)
    expect(res.json.admin).toMatchObject({ roles: ['loan_officer'], linkedMemberId: TEST_IDS.otherMember })
  })
})
