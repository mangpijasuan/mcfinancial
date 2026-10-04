// TOTP multi-factor authentication (RFC 6238) and one-time recovery codes.
// TOTP secrets are Restricted data: encrypted at rest with
// MFA_ENCRYPTION_KEY (AES-256-GCM) and never logged or returned after
// enrolment. Recovery codes are stored only as SHA-256 hashes.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

const ISSUER = 'Millionaires Club'
const PERIOD = 30
const RECOVERY_CODE_COUNT = 10

function encryptionKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY
  const key = raw ? Buffer.from(raw, 'base64') : null
  if (!key || key.length !== 32) {
    throw new Error('MFA_ENCRYPTION_KEY must be set to 32 random bytes, base64-encoded (openssl rand -base64 32).')
  }
  return key
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised MFA secret format.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

function totpFor(secretBase32: string, label = 'staff') {
  return new OTPAuth.TOTP({
    issuer: ISSUER, label, algorithm: 'SHA1', digits: 6, period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  })
}

/** A fresh secret plus the otpauth:// URI an authenticator app scans. */
export function newTotpEnrolment(accountLabel: string) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32
  return { secret, uri: totpFor(secret, accountLabel).toString() }
}

/** The time step a valid code belongs to (±1 step for clock drift), or null. */
export function totpStep(secretBase32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const delta = totpFor(secretBase32).validate({ token: code, timestamp: now, window: 1 })
  if (delta === null) return null
  return Math.floor(now / 1000 / PERIOD) + delta
}

/** Current code for a secret — used by tests and the local smoke script. */
export function currentTotp(secretBase32: string, now = Date.now()) {
  return totpFor(secretBase32).generate({ timestamp: now })
}

function normaliseRecoveryCode(code: string) {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function hashRecoveryCode(code: string) {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex')
}

/** Replaces the account's recovery codes; returns the new codes (shown once). */
export async function issueRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(10)
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
    return `${chars.slice(0, 5)}-${chars.slice(5)}`
  })
  await db.mfaRecoveryCode.deleteMany({ where: { userId } })
  await db.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })) })
  return codes
}

export type SecondFactorResult = { ok: true; method: 'totp' | 'recovery_code' } | { ok: false }

/**
 * Checks a TOTP code or a recovery code for an enrolled account. A TOTP
 * code is accepted once (its time step is recorded, atomically, so a
 * replayed or concurrently submitted code fails); a recovery code is
 * burned on use.
 */
export async function verifySecondFactor(
  db: Db,
  user: { id: string; mfaSecret: string | null },
  code: string,
): Promise<SecondFactorResult> {
  const trimmed = code.trim()
  if (!user.mfaSecret || !trimmed) return { ok: false }

  if (/^\d{6}$/.test(trimmed)) {
    const step = totpStep(decryptSecret(user.mfaSecret), trimmed)
    if (step === null) return { ok: false }
    const claimed = await db.user.updateMany({
      where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
      data: { mfaLastUsedStep: step },
    })
    return claimed.count === 1 ? { ok: true, method: 'totp' } : { ok: false }
  }

  const burned = await db.mfaRecoveryCode.updateMany({
    where: { userId: user.id, codeHash: hashRecoveryCode(trimmed), usedAt: null },
    data: { usedAt: new Date() },
  })
  return burned.count === 1 ? { ok: true, method: 'recovery_code' } : { ok: false }
}
