import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseFixtures } from './helpers/factories'
import { TEST_IDS, signInAs, staffId } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { callRoute } from './helpers/routes'
import { SHEETS_SERVICE_ACCOUNT, SHEETS_TEST_ID, fakeGoogleSheets } from './helpers/fakeGoogleSheets'
import { cents } from '@/lib/money'
import { recordContribution } from '@/lib/paymentActions'
import { approveAccounts, postEntry } from '@/modules/accounting/ledger'
import { systemAuditContext } from '@/modules/audit'
import { EXPORT_KEYS, buildExport, isExportKey, toCsv } from '@/modules/data/export'
import { ABOUT_TAB, GoogleSheetsError, PROTECTION_NOTE, exportToGoogleSheets, setGoogleFetch, sheetsConfig, sheetsStatus } from '@/modules/data/googleSheets'

const ctx = systemAuditContext('sheets-export')
let google: ReturnType<typeof fakeGoogleSheets>
let started: Date
const GOOGLE_KEYS = ['GOOGLE_SHEETS_EXPORT_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_TOKEN_URL', 'GOOGLE_SHEETS_API']

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

beforeEach(async () => {
  started = new Date()
  await resetDatabase()
  await createBaseFixtures()
  google = fakeGoogleSheets()
  setGoogleFetch(google.fetch)
  setEnv(google.env)
})
afterEach(() => {
  setGoogleFetch(null)
  setEnv(Object.fromEntries(GOOGLE_KEYS.map((k) => [k, undefined])))
  vi.restoreAllMocks()
})

describe('export tables', () => {
  it('has a table for every kind of record, and nothing else', () => {
    expect(EXPORT_KEYS).toEqual(['members', 'contributions', 'loans', 'repayments', 'older_loans', 'withdrawals', 'ledger'])
    expect(isExportKey('members')).toBe(true)
    expect(isExportKey('users')).toBe(false)
    expect(isExportKey('__proto__')).toBe(false)
    expect(isExportKey(3)).toBe(false)
  })

  it('exports the records as the app shows them, with dates and dollars spreadsheets understand', async () => {
    await prisma.member.update({ where: { id: TEST_IDS.member }, data: { email: 'ada@example.test', phoneNo: '555-0100' } })
    await prisma.$transaction((tx) => recordContribution(tx, { memberId: TEST_IDS.member, amount: 20, paymentDate: new Date('2026-02-03T12:00:00Z'), paymentMethod: 'Zelle', comments: 'test', source: 'Test' }))
    await prisma.loan.update({ where: { loanId: 'LN-TEST-A' }, data: { overdue: true, nextDueDate: new Date('2026-03-15T00:00:00Z') } })
    await prisma.loanPayment.create({ data: { paymentId: 'LP-1', loanId: 'LN-TEST-A', borrowerId: TEST_IDS.member, borrowerName: 'Ada', paymentDate: new Date('2026-02-15T00:00:00Z'), amount: 100.5 } })
    await prisma.historicalLoan.create({ data: { loanId: 'HE-1', year: 2023, borrowerName: 'Ada', loanDate: new Date('2023-04-01T00:00:00Z'), loanAmount: 800, totalPaid: 800, confirmedBalanceCents: BigInt(0), balanceAsOf: new Date('2025-12-31T00:00:00Z'), balanceConfirmedBy: 'staff-treasurer' } })
    await prisma.withdrawal.create({ data: { withdrawalId: 'WD-1', memberId: TEST_IDS.member, memberName: 'Ada', amount: 50, withdrawalDate: new Date('2026-02-20T00:00:00Z') } })
    const codes = (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code)
    await prisma.$transaction((tx) => approveAccounts(tx, { codes, approvedBy: staffId('treasurer'), note: 'test chart approval' }))
    await prisma.$transaction((tx) => postEntry(tx, {
      effectiveDate: '2026-02-21', type: 'adjustment', description: 'Test entry', idempotencyKey: 'test:export',
      lines: [{ account: '5010', debit: cents(30_00), memo: 'hosting' }, { account: '1000', credit: cents(30_00) }],
    }))

    const members = await buildExport('members')
    expect(members.title).toBe('Members')
    const ada = members.rows.find((r) => r[0] === TEST_IDS.member)!
    expect(ada.slice(5, 7)).toEqual(['555-0100', 'ada@example.test'])
    expect(members.headers).toHaveLength(ada.length)

    // A row recorded before receipts existed: "Covers" falls back to its month.
    await prisma.contribution.create({ data: { transactionId: 'CON-OLD', memberId: TEST_IDS.otherMember, memberName: 'Old', paymentDate: new Date('2026-01-05T12:00:00Z'), monthYear: 'Jan 2026', amount: 20, amountCents: BigInt(2000) } })
    const contributions = await buildExport('contributions')
    expect(contributions.rows[0].slice(0, 1)).toEqual(['CON-OLD'])
    expect(contributions.rows[0][7]).toBe('Jan 2026')
    const c = contributions.rows[1]
    expect(c[2]).toBe(TEST_IDS.member)
    expect(c[4]).toBe('2026-02-03')
    expect(c[5]).toBe(20)
    expect(c[11]).toBeNull() // not reversed

    const loans = await buildExport('loans')
    const loan = loans.rows.find((r) => r[0] === 'LN-TEST-A')!
    expect(loan).toEqual(expect.arrayContaining(['2026-03-15', 'Yes']))
    expect(loans.rows.find((r) => r[0] === 'LN-TEST-B')).toEqual(expect.arrayContaining(['No', null]))

    expect((await buildExport('repayments')).rows).toEqual([['LP-1', 'LN-TEST-A', TEST_IDS.member, 'Ada', '2026-02-15', 100.5, null, null, null]])
    await prisma.historicalLoan.create({ data: { loanId: 'HE-2', year: 2024, borrowerName: 'Ben', loanDate: new Date('2024-04-01T00:00:00Z'), loanAmount: 500, status: 'Active', balanceRemaining: 500 } })
    expect((await buildExport('older_loans')).rows[1].slice(11, 13)).toEqual([null, null]) // no confirmed balance yet
    const older = (await buildExport('older_loans')).rows[0]
    expect(older.slice(0, 2)).toEqual(['HE-1', 2023])
    expect(older[11]).toBe(0)
    expect(older[12]).toBe('2025-12-31')
    expect((await buildExport('withdrawals')).rows[0]).toEqual(['WD-1', TEST_IDS.member, 'Ada', '2026-02-20', 50, 'Partial', null, null])
    const ledger = (await buildExport('ledger')).rows
    expect(ledger).toEqual(expect.arrayContaining([
      expect.arrayContaining(['2026-02-21', 'adjustment', 'Test entry', '5010', 30, null, 'hosting']),
      expect.arrayContaining(['1000', null, 30]),
    ]))
  })

  it('writes CSV that Excel opens correctly and that cannot smuggle a formula in', () => {
    const csv = toCsv({ headers: ['Name', 'Amount', 'Note'], rows: [
      ['=HYPERLINK("http://evil.example")', 20.5, null],
      ['O"Brien, Ann', -5, '+1 555'],
      ['@SUM(A1)', 0, 'line\nbreak'],
      ['-10', 1, '\tTab'],
    ] })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Name,Amount,Note',
      `"'=HYPERLINK(""http://evil.example"")",20.5,`,
      `"O""Brien, Ann",-5,'+1 555`,
      `'@SUM(A1),0,"line\nbreak"`,
      `'-10,1,'\tTab`,
      '',
    ])
  })
})

describe('CSV downloads', () => {
  it('lets the Treasurer and Auditor download a table, records each download, and nobody else', async () => {
    signInAs('treasurer')
    const res = await callRoute('data/export/[table]', 'GET', { params: { table: 'members' } })
    expect(res.status).toBe(200)
    expect(String(res.json)).toContain('Member ID,Legal name')
    expect(String(res.json)).toContain(TEST_IDS.member)
    expect(await prisma.auditLog.count({ where: { action: 'data.export', entityId: 'members', at: { gte: started } } })).toBe(1)
    expect((await callRoute('data/export/[table]', 'GET', { params: { table: 'users' } })).status).toBe(404)

    signInAs('auditor')
    expect((await callRoute('data/export/[table]', 'GET', { params: { table: 'ledger' } })).status).toBe(200)
    for (const actor of ['finance', 'board', 'compliance', 'member'] as const) {
      signInAs(actor)
      expect((await callRoute('data/export/[table]', 'GET', { params: { table: 'members' } })).status, actor).toBe(403)
    }
  })

  it('names the file after the table and the day, and is never cached', async () => {
    signInAs('treasurer')
    const mod = await import('@/app/api/data/export/[table]/route')
    const { NextRequest } = await import('next/server')
    const res = await mod.GET(new NextRequest('http://localhost/api/data/export/older_loans'), { params: Promise.resolve({ table: 'older_loans' }) })
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="millionaires-club-older-loans-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('the Google Sheets copy', () => {
  it('is off until a service account and spreadsheet are set, and talks to Google by default', () => {
    expect(sheetsConfig({})).toBeNull()
    expect(sheetsConfig({ GOOGLE_SHEETS_EXPORT_ID: 'x', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'a@b' })).toBeNull()
    expect(sheetsConfig({ GOOGLE_SHEETS_EXPORT_ID: ' x ', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'a@b', GOOGLE_SERVICE_ACCOUNT_KEY: 'line1\\nline2' })).toEqual({
      spreadsheetId: 'x', clientEmail: 'a@b', privateKey: 'line1\nline2',
      tokenUrl: 'https://oauth2.googleapis.com/token', apiBase: 'https://sheets.googleapis.com',
    })
  })

  it('writes every table to its own tab, locks the tabs, and records the copy', async () => {
    await prisma.$transaction((tx) => recordContribution(tx, { memberId: TEST_IDS.member, amount: 20, paymentDate: new Date('2026-02-03T12:00:00Z'), paymentMethod: '=cmd|calc', comments: 't', source: 'Test' }))
    const now = new Date('2026-10-10T02:30:00Z')
    const result = await exportToGoogleSheets(ctx, now)
    expect(result.tabs.map((t) => t.title)).toEqual(['Members', 'Contributions', 'Loans', 'Loan repayments', 'Older loans (2021–2025)', 'Withdrawals', 'Ledger'])

    // Signed in as the service account, for spreadsheets only.
    expect(google.state.grants[0]).toMatchObject({ iss: SHEETS_SERVICE_ACCOUNT, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://google.test/token' })
    // The club's own tab is left alone; ours are added once, and locked to the service account.
    const titles = google.state.sheets.map((s) => s.title)
    expect(titles).toEqual(['Sheet1', ABOUT_TAB, ...result.tabs.map((t) => t.title)])
    expect(google.state.sheets[0].protectedRanges).toEqual([])
    for (const s of google.state.sheets.slice(1)) {
      expect(s.protectedRanges).toEqual([{ description: PROTECTION_NOTE, editors: { users: [SHEETS_SERVICE_ACCOUNT] }, warningOnly: false }])
    }
    expect(google.state.values.get('Members')![0][0]).toBe('Member ID')
    expect(google.state.values.get('Members')).toHaveLength(3) // header + 2 members
    // Values go in as typed (RAW): a formula-looking value stays text.
    expect(google.state.values.get('Contributions')![1]).toContain('=cmd|calc')
    const about = google.state.values.get(ABOUT_TAB)!
    expect(about[1]).toEqual(['Copied at (UTC)', '2026-10-10 02:30'])
    expect(about).toContainEqual(['Members', 2, expect.any(String)])
    expect(await prisma.auditLog.count({ where: { action: 'data.sheets_export', entityId: SHEETS_TEST_ID, at: { gte: started } } })).toBe(1)

    // The next copy replaces the values without adding or re-locking tabs.
    google.state.values.set('Members', [['typed by someone'], ['x'], ['y'], ['z']])
    await exportToGoogleSheets(ctx)
    expect(google.state.sheets).toHaveLength(9)
    expect(google.state.sheets[1].protectedRanges).toHaveLength(1)
    expect(google.state.values.get('Members')).toHaveLength(3)
    expect(google.state.calls.filter((c) => c === `POST /sheets/v4/spreadsheets/${SHEETS_TEST_ID}:batchUpdate`)).toHaveLength(2) // tabs and locks: first copy only
  })

  it('locks a tab of ours again if its lock was removed', async () => {
    await exportToGoogleSheets(ctx)
    google.state.sheets.find((s) => s.title === 'Ledger')!.protectedRanges = []
    await exportToGoogleSheets(ctx)
    expect(google.state.sheets.find((s) => s.title === 'Ledger')!.protectedRanges).toHaveLength(1)
  })

  it('says what is wrong, in words the Treasurer can act on', async () => {
    setEnv({ GOOGLE_SHEETS_EXPORT_ID: undefined })
    await expect(exportToGoogleSheets(ctx)).rejects.toThrow('The Google Sheets copy is not set up on this server.')
    setEnv(google.env)

    setEnv({ GOOGLE_SERVICE_ACCOUNT_KEY: 'not a key' })
    await expect(exportToGoogleSheets(ctx)).rejects.toThrow(/not a valid private key/)
    setEnv(google.env)

    google.state.tokenStatus = 400
    google.state.tokenError = 'Invalid grant: account not found'
    await expect(exportToGoogleSheets(ctx)).rejects.toThrow('Google refused the service account: Invalid grant: account not found.')
    google.state.tokenError = undefined
    await expect(exportToGoogleSheets(ctx)).rejects.toThrow('Google refused the service account.')
    google.state.tokenStatus = 200

    setEnv({ GOOGLE_SHEETS_EXPORT_ID: 'someone-elses-sheet' })
    await expect(exportToGoogleSheets(ctx)).rejects.toThrow('Google Sheets: Requested entity was not found.. Check the spreadsheet ID, and that the sheet is shared with the service account as an editor.')
    setEnv(google.env)
    google.state.failures.push({ match: /values:batchUpdate/, status: 403, body: { error: { message: 'The caller does not have permission' } } })
    await expect(exportToGoogleSheets(ctx)).rejects.toThrow(/does not have permission.*shared with the service account/)
    google.state.failures.push({ match: /values:batchClear/, status: 500 })
    await expect(exportToGoogleSheets(ctx)).rejects.toThrow(/^Google Sheets: HTTP 500\.$/)
    expect(await prisma.auditLog.count({ where: { action: 'data.sheets_export', at: { gte: started } } })).toBe(0)
  })

  it('reports whether it is set up and when it last ran', async () => {
    // The audit log is never reset, so "never copied" is seen by hiding it.
    vi.spyOn(prisma.auditLog, 'findFirst').mockResolvedValueOnce(null)
    expect(await sheetsStatus()).toEqual({
      configured: true, serviceAccount: SHEETS_SERVICE_ACCOUNT, lastExportAt: null,
      url: `https://docs.google.com/spreadsheets/d/${SHEETS_TEST_ID}`,
    })
    await exportToGoogleSheets(ctx)
    expect((await sheetsStatus()).lastExportAt!.getTime()).toBeGreaterThanOrEqual(started.getTime())
    setEnv({ GOOGLE_SHEETS_EXPORT_ID: undefined })
    expect(await sheetsStatus()).toMatchObject({ configured: false, serviceAccount: null, url: null })
  })

  it('can go back to the real network after a test', () => {
    setGoogleFetch(null)
    setGoogleFetch(google.fetch)
  })

  it('copies now from the Data Export page, for the Treasurer only', async () => {
    signInAs('treasurer')
    expect((await callRoute('data/sheets', 'GET')).json.configured).toBe(true)
    const res = await callRoute('data/sheets', 'POST')
    expect(res.status).toBe(200)
    expect(res.json.result.tabs).toHaveLength(7)
    expect(res.json.status.lastExportAt).not.toBeNull()

    google.state.failures.push({ match: /values:batchUpdate/, status: 403, body: { error: { message: 'No access' } } })
    const failed = await callRoute('data/sheets', 'POST')
    expect(failed.status).toBe(502)
    expect(failed.json.error).toMatch(/No access/)

    vi.spyOn(prisma.member, 'findMany').mockRejectedValueOnce(new Error('database down'))
    await expect(callRoute('data/sheets', 'POST')).rejects.toThrow('database down')

    signInAs('finance')
    expect((await callRoute('data/sheets', 'GET')).status).toBe(403)
    expect((await callRoute('data/sheets', 'POST')).status).toBe(403)
  })

  it('uses a GoogleSheetsError for anything Google refuses', () => {
    expect(new GoogleSheetsError('x')).toBeInstanceOf(Error)
  })
})
