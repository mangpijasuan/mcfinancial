// A stand-in for Google's token endpoint and the Sheets API, just enough
// for the read-only copy: tabs, protections and values.
import { createVerify, generateKeyPairSync } from 'node:crypto'

export const SHEETS_TEST_ID = 'sheet-test-1'
export const SHEETS_SERVICE_ACCOUNT = 'mc-export@club-project.iam.gserviceaccount.com'
const TOKEN_URL = 'https://google.test/token'
const API = 'https://google.test/sheets'

type Cell = string | number | null
type Sheet = { sheetId: number; title: string; protectedRanges: { description?: string; editors?: unknown; warningOnly?: boolean }[] }

export function fakeGoogleSheets() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const env = {
    GOOGLE_SHEETS_EXPORT_ID: SHEETS_TEST_ID,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: SHEETS_SERVICE_ACCOUNT,
    // As it is usually pasted into an env file: one line, "\n" for line breaks.
    GOOGLE_SERVICE_ACCOUNT_KEY: pem.replace(/\n/g, '\\n'),
    GOOGLE_TOKEN_URL: TOKEN_URL,
    GOOGLE_SHEETS_API: API,
  }
  let nextId = 100
  const state = {
    sheets: [{ sheetId: 0, title: 'Sheet1', protectedRanges: [] }] as Sheet[],
    values: new Map<string, Cell[][]>(),
    tokenStatus: 200,
    tokenError: undefined as string | undefined,
    grants: [] as { iss: string; scope: string; aud: string }[],
    failures: [] as { match: RegExp; status: number; body?: unknown }[],
    calls: [] as string[],
  }
  const json = (body: unknown, status = 200) => new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })
  const title = (range: string) => range.replace(/!.*$/, '').replace(/^'(.*)'$/, '$1').replace(/''/g, "'")

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const call = `${method} ${url.pathname}`
    state.calls.push(call)
    const failure = state.failures.findIndex((f) => f.match.test(call))
    if (failure >= 0) {
      const [f] = state.failures.splice(failure, 1)
      return json(f.body, f.status)
    }

    if (url.href === TOKEN_URL) {
      const assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? ''
      const [head, claims, sig] = assertion.split('.')
      // Like Google: only a JWT signed with the service account's key is accepted.
      const valid = createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, sig, 'base64url')
      if (!valid) return json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400)
      state.grants.push(JSON.parse(Buffer.from(claims, 'base64url').toString()))
      if (state.tokenStatus !== 200) return json(state.tokenError ? { error: 'invalid_grant', error_description: state.tokenError } : undefined, state.tokenStatus)
      return json({ access_token: 'ya29.test', expires_in: 3600 })
    }

    const m = url.pathname.match(/^\/sheets\/v4\/spreadsheets\/([^/:]+)(.*)$/)
    if (!m || decodeURIComponent(m[1]) !== SHEETS_TEST_ID) return json({ error: { message: 'Requested entity was not found.' } }, 404)
    if ((init?.headers as Record<string, string>)?.Authorization !== 'Bearer ya29.test') return json({ error: { message: 'Unauthenticated' } }, 401)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const rest = m[2]

    if (rest === '' && method === 'GET') {
      return json({ sheets: state.sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title }, ...(s.protectedRanges.length ? { protectedRanges: s.protectedRanges } : {}) })) })
    }
    if (rest === ':batchUpdate') {
      for (const r of body.requests) {
        if (r.addSheet) state.sheets.push({ sheetId: nextId++, title: r.addSheet.properties.title, protectedRanges: [] })
        if (r.addProtectedRange) {
          const p = r.addProtectedRange.protectedRange
          state.sheets.find((s) => s.sheetId === p.range.sheetId)!.protectedRanges.push({ description: p.description, editors: p.editors, warningOnly: p.warningOnly })
        }
      }
      return json({ replies: [] })
    }
    if (rest === '/values:batchClear') {
      for (const r of body.ranges) state.values.delete(title(r))
      return json({ clearedRanges: body.ranges })
    }
    if (rest === '/values:batchUpdate') {
      if (body.valueInputOption !== 'RAW') return json({ error: { message: 'expected RAW' } }, 400)
      for (const d of body.data) state.values.set(title(d.range), d.values)
      return json({ totalUpdatedRows: body.data.length })
    }
    return json({}, 404)
  }) as typeof fetch

  return { env, state, fetch: fetchFn }
}
