// A read-only copy of the club's records in a Google Sheet, refreshed
// nightly and on demand (docs/operations/data-export.md).
//
// The app signs in as a Google service account that the club shares one
// spreadsheet with; it can reach nothing else in the club's Google account.
// Each table goes to its own tab, rewritten whole each time, and every tab
// is protected so only the service account can edit it: the copy is for
// reading, and nothing typed into it ever reaches the app.
import { createSign } from 'node:crypto'
import { recordAudit, type AuditContext } from '@/modules/audit'
import { prisma } from '@/lib/prisma'
import { EXPORT_KEYS, buildExport, type Cell } from './export'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
/** Marks the protections this app adds, so it never touches the club's own. */
export const PROTECTION_NOTE = 'Millionaires Club app: read-only copy'
export const ABOUT_TAB = 'About this copy'

type Fetch = typeof fetch
let fetchImpl: Fetch = globalThis.fetch
/** Tests replace Google with a stand-in; nothing else calls this. */
export function setGoogleFetch(f: Fetch | null) { fetchImpl = f ?? globalThis.fetch }

export class GoogleSheetsError extends Error {}

export type SheetsConfig = { spreadsheetId: string; clientEmail: string; privateKey: string; tokenUrl: string; apiBase: string }

/** The service account and spreadsheet, or null while the copy is not set up. */
export function sheetsConfig(env: Record<string, string | undefined> = process.env): SheetsConfig | null {
  const spreadsheetId = env.GOOGLE_SHEETS_EXPORT_ID?.trim()
  const clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  // The key is often pasted on one line with "\n" for its line breaks.
  const privateKey = env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n').trim()
  if (!spreadsheetId || !clientEmail || !privateKey) return null
  return {
    spreadsheetId, clientEmail, privateKey,
    // The defaults are Google's; the overrides exist for the tests' stand-in.
    tokenUrl: env.GOOGLE_TOKEN_URL?.trim() || 'https://oauth2.googleapis.com/token',
    apiBase: env.GOOGLE_SHEETS_API?.trim() || 'https://sheets.googleapis.com',
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

/** A one-hour access token for the service account (OAuth 2.0 JWT bearer grant). */
async function accessToken(cfg: SheetsConfig, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: cfg.tokenUrl, iat, exp: iat + 3600 }))}`
  let signature: string
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(cfg.privateKey, 'base64url')
  } catch {
    throw new GoogleSheetsError('The service account key is not a valid private key. Paste the "private_key" from its JSON key file.')
  }
  const res = await fetchImpl(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
  })
  const body = await res.json().catch(() => null) as { access_token?: string; error_description?: string } | null
  if (!res.ok || !body?.access_token) throw new GoogleSheetsError(`Google refused the service account${body?.error_description ? `: ${body.error_description}` : ''}.`)
  return body.access_token
}

async function call<T>(cfg: SheetsConfig, token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetchImpl(`${cfg.apiBase}/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null) as (T & { error?: { message?: string } }) | null
  if (!res.ok || !json) {
    const hint = res.status === 403 || res.status === 404 ? ' Check the spreadsheet ID, and that the sheet is shared with the service account as an editor.' : ''
    throw new GoogleSheetsError(`Google Sheets: ${json?.error?.message ?? `HTTP ${res.status}`}.${hint}`)
  }
  return json
}

type SheetInfo = { properties: { sheetId: number; title: string }; protectedRanges?: { description?: string }[] }

/** A sheet tab's name in A1 notation, quoted (titles may hold spaces and dashes). */
const a1 = (title: string) => `'${title.replace(/'/g, "''")}'`

export type SheetsExportResult = { at: Date; tabs: { title: string; rows: number }[] }

/**
 * Rewrites the copy: one tab per table, plus a note saying when it was
 * made and that it is read-only. Audited. Throws GoogleSheetsError with a
 * message the Treasurer can act on.
 */
export async function exportToGoogleSheets(ctx: AuditContext, now = new Date()): Promise<SheetsExportResult> {
  const cfg = sheetsConfig()
  if (!cfg) throw new GoogleSheetsError('The Google Sheets copy is not set up on this server.')
  const tables = await Promise.all(EXPORT_KEYS.map((k) => buildExport(k)))
  const token = await accessToken(cfg, now.getTime())

  const titles = [ABOUT_TAB, ...tables.map((t) => t.title)]
  const read = async () => (await call<{ sheets: SheetInfo[] }>(cfg, token, 'GET', '?fields=sheets(properties(sheetId,title),protectedRanges(description))')).sheets
  let sheets = await read()
  const missing = titles.filter((t) => !sheets.some((s) => s.properties.title === t))
  if (missing.length) {
    await call(cfg, token, 'POST', ':batchUpdate', { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) })
    sheets = await read()
  }
  const ours = sheets.filter((s) => titles.includes(s.properties.title))
  const unprotected = ours.filter((s) => !(s.protectedRanges ?? []).some((p) => p.description === PROTECTION_NOTE))
  if (unprotected.length) {
    await call(cfg, token, 'POST', ':batchUpdate', {
      requests: unprotected.map((s) => ({
        addProtectedRange: { protectedRange: { range: { sheetId: s.properties.sheetId }, description: PROTECTION_NOTE, warningOnly: false, editors: { users: [cfg.clientEmail] } } },
      })),
    })
  }

  const about: Cell[][] = [
    ['Millionaires Club: a read-only copy of the app’s records'],
    ['Copied at (UTC)', now.toISOString().replace('T', ' ').slice(0, 16)],
    ['Do not edit this copy: it is replaced at every copy, and nothing typed here reaches the app.'],
    [],
    ['Tab', 'Rows', 'What it holds'],
    ...tables.map((t) => [t.title, t.rows.length, t.description]),
  ]
  await call(cfg, token, 'POST', '/values:batchClear', { ranges: titles.map(a1) })
  await call(cfg, token, 'POST', '/values:batchUpdate', {
    // RAW: every value is stored as typed, so text is never read as a formula.
    valueInputOption: 'RAW',
    data: [
      { range: `${a1(ABOUT_TAB)}!A1`, values: about },
      ...tables.map((t) => ({ range: `${a1(t.title)}!A1`, values: [t.headers, ...t.rows] })),
    ],
  })

  const result = { at: now, tabs: tables.map((t) => ({ title: t.title, rows: t.rows.length })) }
  await recordAudit(prisma, ctx, {
    action: 'data.sheets_export', entityType: 'data_export', entityId: cfg.spreadsheetId,
    metadata: { tabs: result.tabs },
  })
  return result
}

/** Whether the copy is set up, and when it was last made. */
export async function sheetsStatus() {
  const cfg = sheetsConfig()
  const last = await prisma.auditLog.findFirst({ where: { action: 'data.sheets_export' }, orderBy: { id: 'desc' }, select: { at: true } })
  return {
    configured: cfg !== null,
    serviceAccount: cfg?.clientEmail ?? null,
    url: cfg ? `https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}` : null,
    lastExportAt: last?.at ?? null,
  }
}
