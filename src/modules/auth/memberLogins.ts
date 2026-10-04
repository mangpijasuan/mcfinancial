// A member's portal login (M8): a User of kind "member". Portal access is
// on when the member has a login that is not switched off. A new password,
// or switching access off, ends the member's existing sessions.
import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'
import { OperationError } from '@/lib/operationError'

type Db = Pick<Prisma.TransactionClient, 'user' | 'member'>
type RawDb = Pick<Prisma.TransactionClient, '$executeRawUnsafe'>

export const MEMBER_PASSWORD_MIN_LENGTH = 8

const loginOf = (db: Db, memberId: string) =>
  db.user.findUnique({ where: { kind_memberId: { kind: 'member', memberId } }, select: { id: true, disabledAt: true } })

/** Whether the member can sign in to the portal. */
export async function portalAccess(db: Db, memberId: string): Promise<boolean> {
  const login = await loginOf(db, memberId)
  return Boolean(login && !login.disabledAt)
}

/** Portal access for several members at once. */
export async function portalAccessFor(db: Db, memberIds: string[]): Promise<Set<string>> {
  const logins = await db.user.findMany({
    where: { kind: 'member', memberId: { in: memberIds }, disabledAt: null },
    select: { memberId: true },
  })
  return new Set(logins.map((l) => l.memberId!))
}

/**
 * Give access (with a password the first time), change the password, or
 * switch access on or off. Returns whether access is on afterwards.
 */
export async function setPortalAccess(db: Db, memberId: string, change: { password?: string; enabled?: boolean }) {
  const member = await db.member.findUnique({ where: { id: memberId }, select: { id: true, legalName: true } })
  if (!member) throw new OperationError(404, 'Member not found.')
  if (change.password !== undefined && change.password.length < MEMBER_PASSWORD_MIN_LENGTH) {
    throw new OperationError(400, `The password must be at least ${MEMBER_PASSWORD_MIN_LENGTH} characters.`)
  }
  const login = await loginOf(db, memberId)
  const before = Boolean(login && !login.disabledAt)
  const now = new Date()
  const enabled = change.enabled ?? (change.password ? true : before)

  if (!login) {
    if (!change.password) {
      if (enabled) throw new OperationError(400, 'Set a password to give this member portal access.')
      return { before, after: false, passwordChanged: false }
    }
    await db.user.create({
      data: {
        kind: 'member', memberId, name: member.legalName,
        passwordHash: await bcrypt.hash(change.password, 10),
        disabledAt: enabled ? null : now,
      },
    })
    return { before, after: enabled, passwordChanged: true }
  }

  const passwordHash = change.password ? await bcrypt.hash(change.password, 10) : undefined
  const switchedOff = before && !enabled
  await db.user.update({
    where: { id: login.id },
    data: {
      ...(passwordHash ? { passwordHash } : {}),
      disabledAt: enabled ? null : login.disabledAt ?? now,
      ...(passwordHash || switchedOff ? { sessionsValidAfter: now } : {}),
    },
  })
  return { before, after: enabled, passwordChanged: Boolean(passwordHash) }
}

/**
 * Data loaded the old way (an import or seed file written before M8) puts a
 * member's portal password on the member record. Give each such member a
 * login with the same hash, access and session cut-off, unless they have
 * one already. Safe to run again. The SQL is the M8 migration's.
 */
export const ADOPT_PORTAL_LOGINS_SQL = `
INSERT INTO "User" ("id", "kind", "name", "passwordHash", "memberId", "createdAt", "disabledAt", "sessionsValidAfter")
SELECT 'mu_' || replace(gen_random_uuid()::text, '-', ''), 'member', m."legalName", m."portalPassword", m."id", CURRENT_TIMESTAMP,
       CASE WHEN m."portalEnabled" THEN NULL ELSE CURRENT_TIMESTAMP END, m."portalSessionsValidAfter"
FROM "Member" m
WHERE m."portalPassword" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."kind" = 'member' AND u."memberId" = m."id")`

export async function adoptPortalLogins(db: RawDb): Promise<number> {
  return db.$executeRawUnsafe(ADOPT_PORTAL_LOGINS_SQL)
}
