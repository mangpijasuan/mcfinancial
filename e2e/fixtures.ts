// Shared constants for the browser tests. The accounts are synthetic and
// exist only in the e2e database (never real member data, S-7).
import * as OTPAuth from 'otpauth'

export const PORT = Number(process.env.E2E_PORT || 3300)
export const BASE_URL = `http://localhost:${PORT}`

export const STAFF_PASSWORD = 'correct horse battery staple'
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

/** One account per role the golden paths need. */
export const STAFF = {
  treasurer: { id: 'e2e-treasurer', email: 'treasurer@e2e.test', name: 'Tess Treasurer', role: 'treasurer' },
  finance: { id: 'e2e-finance', email: 'finance@e2e.test', name: 'Fin Finance', role: 'finance' },
  loan_officer: { id: 'e2e-loans', email: 'loans@e2e.test', name: 'Lou Loans', role: 'loan_officer' },
  board: { id: 'e2e-board', email: 'board@e2e.test', name: 'Bea Board', role: 'board' },
} as const
export type StaffRole = keyof typeof STAFF

export const MEMBER = { id: 'MC-E2E-01', name: 'Ada Example', password: 'member passphrase 2026' }
export const COSIGNER = { id: 'MC-E2E-04', name: 'Cara Example', password: 'cosigner passphrase 2026' }
export const OTHER_MEMBER = { id: 'MC-E2E-02', name: 'Ben Example' }
/** A second member with the same name as OTHER_MEMBER (the 2021–2025 records cannot tell them apart). */
export const NAMESAKE = { id: 'MC-E2E-03', name: 'Ben Example' }

export const authFile = (role: StaffRole | 'member' | 'cosigner') => `e2e/.auth/${role}.json`

/** The authenticator code right now. */
export function totp(now = Date.now()) {
  return new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(TOTP_SECRET) }).generate({ timestamp: now })
}

/**
 * The browser-test database: `mcfinancial_e2e` on the local Docker database
 * (port 5434) unless E2E_DATABASE_URL says otherwise. It is wiped on every
 * run, so its name must end in _e2e or _test.
 */
export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL || 'postgresql://mcfinancial:mcfinancial_dev@127.0.0.1:5434/mcfinancial_e2e?schema=public'
  const name = new URL(url).pathname.slice(1)
  if (!/_(e2e|test)$/.test(name)) throw new Error(`Refusing to run browser tests against "${name}": the database name must end in _e2e or _test.`)
  return url
}

/** The environment the app runs with in the browser tests (seed and server must agree on the MFA key). */
export function e2eEnv(): Record<string, string> {
  return {
    DATABASE_URL: e2eDatabaseUrl(),
    NEXTAUTH_URL: BASE_URL,
    NEXTAUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
    MFA_ENCRYPTION_KEY: 'ZTJlLWtleS1lMmUta2V5LWUyZS1rZXktMDEyMzQ1Njc=', // gitleaks:allow (test-only key)
    CLUB_TIME_ZONE: 'America/Chicago',
    DUES_TRACKING_START: '2026-01',
    MAKER_CHECKER_ENFORCED: 'false',
    LATE_FEES_ENABLED: 'false',
    // What the portal shows members to send a Zelle payment to.
    ZELLE_RECIPIENT_NAME: 'Millionaires Club',
    ZELLE_RECIPIENT_EMAIL: 'payments@e2e.test',
  }
}
