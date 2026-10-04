// Seeds the browser-test database: empties it, then adds one staff account
// per role (password + two-factor already set up) and two members. Run by
// e2e/global-setup.ts with the e2e environment (fixtures.e2eEnv()).
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { encryptSecret } from '@/modules/auth/mfa'
import { resetDatabase } from '../tests/helpers/db'
import { MEMBER, OTHER_MEMBER, STAFF, STAFF_PASSWORD, TOTP_SECRET } from './fixtures'

async function main() {
  // This empties the database: refuse anything not named as a test database.
  const name = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  if (!/_(e2e|test)$/.test(name)) throw new Error(`Refusing to reset "${name}": the browser-test database name must end in _e2e or _test.`)
  await resetDatabase()
  const password = await bcrypt.hash(STAFF_PASSWORD, 4)
  for (const s of Object.values(STAFF)) {
    await prisma.admin.create({
      data: {
        id: s.id, email: s.email, name: s.name, password,
        mfaSecret: encryptSecret(TOTP_SECRET), mfaEnabledAt: new Date(),
        roles: { create: [{ role: s.role }] },
      },
    })
  }
  await prisma.member.create({
    data: {
      id: MEMBER.id, legalName: MEMBER.name, joinDate: new Date('2024-01-01'), status: 'Active', email: 'ada@e2e.test',
      monthsActive: 24, archiveLifetime: 2000, contributions2026: 180, overallContributions: 2000,
      portalEnabled: true, portalPassword: await bcrypt.hash(MEMBER.password, 4),
    },
  })
  await prisma.member.create({
    data: {
      id: OTHER_MEMBER.id, legalName: OTHER_MEMBER.name, joinDate: new Date('2024-01-01'), status: 'Active', email: 'ben@e2e.test',
      monthsActive: 24, archiveLifetime: 1000, overallContributions: 1000,
    },
  })
  console.log('e2e database seeded')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
