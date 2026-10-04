// Server-side staff sessions. The JWT cookie carries a random token; the
// database stores only its hash, so a leaked database cannot be replayed
// as sessions. Every staff request checks the row (D-07, S-1).
import { createHash, randomBytes } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export const STAFF_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const STAFF_SESSION_IDLE_MS = 30 * 60 * 1000
/** lastSeenAt is written at most this often, to keep reads cheap. */
export const STAFF_SESSION_TOUCH_MS = 60 * 1000

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createStaffSession(
  db: Db,
  userId: string,
  opts: { mfaVerified: boolean; ip?: string | null; userAgent?: string | null },
) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  await db.staffSession.create({
    data: {
      id: hashSessionToken(token),
      userId,
      expiresAt: new Date(now.getTime() + STAFF_SESSION_MAX_AGE_MS),
      mfaVerifiedAt: opts.mfaVerified ? now : null,
      ip: opts.ip?.slice(0, 100) ?? null,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
    },
  })
  return token
}

/** Ends sessions for an account (all of them, or all but one). */
export async function revokeStaffSessions(db: Db, userId: string, reason: string, exceptSessionId?: string) {
  const result = await db.staffSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  return result.count
}
