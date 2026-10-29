// The monthly contributions report (docs/operations/monthly-report.md):
// its figures, the PDF and CSV downloads, and who may download them.
import { inflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDocument, PDFRawStream, type PDFPage } from 'pdf-lib'
import { cents } from '@/lib/money'
import { type MonthlyReport, buildMonthlyReport, monthLabel, monthlyReportRows, reportMonth } from '@/modules/contributions/monthlyReport'
import { loadLogo, monthlyReportPdf, pdfText } from '@/modules/contributions/monthlyReportPdf'
import { BROUGHT_FORWARD_METHOD } from '@/modules/loans/history'
import { createLoan, createMember, createStaffFixtures } from './helpers/factories'
import { signInAs, signInAsMember } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { callRoute } from './helpers/routes'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
let seq = 0
const contribution = (memberId: string, date: Date | string, amountCents: number, extra: Record<string, unknown> = {}) =>
  prisma.contribution.create({
    data: {
      transactionId: `CON-MR-${++seq}`, memberId, memberName: 'x', paymentDate: typeof date === 'string' ? d(date) : date, monthYear: 'x',
      amount: amountCents / 100, amountCents: BigInt(amountCents), ...extra,
    },
  })

/** The text drawn on a page of the PDF. */
async function pageText(page: PDFPage) {
  const contents = page.node.Contents()!
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents]
  return streams.map((s) => {
    const raw = inflateSync((s as PDFRawStream).contents).toString('latin1')
    return [...raw.matchAll(/<([0-9A-F]*)> Tj/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join('|')
  }).join('|')
}

describe('the month asked for', () => {
  it('is YYYY-MM, this month by default, and never in the future', () => {
    expect(reportMonth(null, '2026-10-28')).toBe('2026-10')
    expect(reportMonth('2026-09', '2026-10-28')).toBe('2026-09')
    expect(reportMonth('2026-11', '2026-10-28')).toBeNull()
    expect(reportMonth('2026-13', '2026-10-28')).toBeNull()
    expect(reportMonth('Oct-2026', '2026-10-28')).toBeNull()
    expect(monthLabel('2026-10')).toBe('October 2026')
  })
})

describe('the figures', () => {
  beforeEach(async () => {
    await resetDatabase()
    await createMember('MC-10002', { legalName: 'Ben Sample', nickname: 'Benpi', joinDate: d('2015-03-01') })
    await createMember('MC-10001', { legalName: 'Ada Example', joinDate: d('2014-01-05') })
    await createMember('MC-10010', { legalName: 'Cara Tester' })
    await createMember('MC-10003', { legalName: 'Dan Gone', status: 'Inactive' })
    await createMember('MC-10004', { legalName: 'Eve Away', status: 'Inactive' })
  })

  it('lists every active member, and anyone else who paid, with the month’s payments and totals', async () => {
    await contribution('MC-10001', '2026-10-03', 2000, { paymentMethod: 'Auto-pay', receiptNumber: 'RC-2026-000001', receiptCovers: 'Oct 2026' })
    await contribution('MC-10001', '2026-10-20', 1000, { paymentMethod: 'Cash', receivedBy: 'Treasurer', category: 'voluntary', comments: 'Gift' })
    await contribution('MC-10003', '2026-10-31', 2000, { paymentMethod: '' })
    // 9:30 pm on Sep 30 in Chicago: September.
    await contribution('MC-10002', new Date('2026-10-01T02:30:00Z'), 2000, { paymentMethod: 'Zelle' })
    // Reversed, or another month: left out.
    await contribution('MC-10010', '2026-10-05', 2000, { reversedAt: new Date(), reversedBy: 'x', reversalReason: 'x' })
    await contribution('MC-10010', '2026-11-01', 2000)

    await createLoan('L02', 'MC-10002')
    const pay = (id: string, date: string, amount: number, paymentMethod: string | null = 'Zelle') =>
      prisma.loanPayment.create({ data: { paymentId: id, loanId: 'L02', borrowerId: 'MC-10002', borrowerName: 'old name', paymentDate: d(date), amount, paymentMethod } })
    await pay('LP-1', '2026-10-05', 416.67)
    await pay('LP-2', '2026-10-31', 100, BROUGHT_FORWARD_METHOD)
    await pay('LP-3', '2026-09-30', 50)

    const report = await buildMonthlyReport(prisma, '2026-10', new Date('2026-10-28T18:00:00Z'))
    expect(report).toMatchObject({ month: '2026-10', label: 'October 2026', generatedOn: '2026-10-28' })
    // Ordered by number, not text; Eve (inactive, unpaid) left out.
    expect(report.members.map((m) => [m.memberId, m.paidCents, m.payments.length])).toEqual([
      ['MC-10001', 3000, 2], ['MC-10002', 0, 0], ['MC-10003', 2000, 1], ['MC-10010', 0, 0],
    ])
    expect(report.members[1]).toMatchObject({ name: 'Ben Sample', nickname: 'Benpi', joined: '2015-03-01', status: 'Active' })
    expect(report.members[0].payments[1]).toEqual({
      date: '2026-10-20', amountCents: 1000, method: 'Cash', receivedBy: 'Treasurer', covers: null, note: 'Gift', receipt: null, voluntary: true,
    })
    expect(report.repayments).toEqual([
      { loanId: 'L02', borrower: 'Ben Sample', memberId: 'MC-10002', date: '2026-10-05', amountCents: 41667, method: 'Zelle', receivedBy: null },
    ])
    expect(report.totals).toEqual({
      activeMembers: 3, paidMembers: 1, unpaidMembers: 2,
      collectedCents: 5000, duesCents: 4000, voluntaryCents: 1000, payments: 3, repaymentsCents: 41667,
      byMethod: [
        { method: 'Auto-pay', cents: 2000, count: 1 }, { method: 'Not given', cents: 2000, count: 1 }, { method: 'Cash', cents: 1000, count: 1 },
      ],
    })

    const sheet = monthlyReportRows(report)
    expect(sheet.headers).toEqual(['Member ID', 'Name', 'Nickname', 'Joined', 'Status', 'Paid', 'Paid on', 'Method', 'Received by', 'Covers', 'Receipts', 'Note'])
    expect(sheet.rows[0]).toEqual(['MC-10001', 'Ada Example', null, '2014-01-05', 'Active', 30, '2026-10-03; 2026-10-20', 'Auto-pay; Cash', 'Treasurer', 'Oct 2026', 'RC-2026-000001', 'Gift'])
    expect(sheet.rows[1]).toEqual(['MC-10002', 'Ben Sample', 'Benpi', '2015-03-01', 'Active', null, '', '', '', '', '', ''])
  })
})

const sampleReport = (o: Partial<MonthlyReport> = {}, members = 3): MonthlyReport => ({
  month: '2026-10', label: 'October 2026', generatedOn: '2026-10-28',
  members: Array.from({ length: members }, (_, i) => ({
    memberId: `MC-${10001 + i}`, name: i === 0 ? 'Ada “Ace” Example – the very long name of a member that does not fit' : `Member ${i}`, nickname: i % 2 ? 'Nick' : null,
    joined: '2015-01-02', status: 'Active', paidCents: cents(i === 1 ? 0 : 2000),
    payments: i === 1 ? [] : [{ date: '2026-10-03', amountCents: cents(2000), method: 'Auto-pay', receivedBy: null, covers: 'Oct 2026', note: null, receipt: null, voluntary: false }],
  })),
  repayments: [{ loanId: 'L02', borrower: 'Ben Sample', memberId: 'MC-10002', date: '2026-10-05', amountCents: cents(41667), method: null, receivedBy: null }],
  totals: {
    activeMembers: members, paidMembers: members - 1, unpaidMembers: 1, collectedCents: cents(2000 * (members - 1)), duesCents: cents(2000 * (members - 1)),
    voluntaryCents: cents(0), payments: members - 1, repaymentsCents: cents(41667),
    byMethod: members > 1 ? [{ method: 'Auto-pay', cents: cents(2000 * (members - 1)), count: members - 1 }] : [],
  },
  ...o,
})

describe('the PDF', () => {
  it('has the club’s header, the totals, every member, the repayments and a sign-off', async () => {
    const pdf = await PDFDocument.load(await monthlyReportPdf(sampleReport()))
    expect(pdf.getTitle()).toBe('Millionaires Club - Monthly Contributions - October 2026')
    expect(pdf.getPageCount()).toBe(1)
    const [page] = pdf.getPages()
    expect(page.getSize()).toEqual({ width: 792, height: 612 })
    const text = await pageText(page)
    for (const s of [
      'Millionaires Club', 'Monthly Contributions Report', 'October 2026', 'Prepared 10/28/2026',
      'COLLECTED', '$40.00', '2 of 3', '67% of active members', 'active member', '1 payment received',
      'MC-10001', 'No payment', '10/03', 'Auto-pay $40.00 (2)', 'Total', '2 payments',
      'Loan repayments received', 'L02', 'Ben Sample', '$416.67', 'Prepared by (Treasurer)', 'Reviewed by', 'Page 1 of 1',
    ]) expect(text, s).toContain(s)
    // A name too long for its column is shortened; quotes and dashes made plain.
    expect(text).toMatch(/Ada "Ace" Example - the.*\.\.\./)
  })

  it('runs over several pages, with the column titles on each', async () => {
    const pdf = await PDFDocument.load(await monthlyReportPdf(sampleReport({}, 80), []))
    expect(pdf.getPageCount()).toBe(4)
    const last = await pageText(pdf.getPage(3))
    expect(last).toContain('Millionaires Club  \xB7  Monthly Contributions Report  \xB7  October 2026')
    expect(last).toContain('Member ID')
    expect(last).toContain('Page 4 of 4')
  })

  it('says so when nothing came in, and wraps a long list of payment methods', async () => {
    const empty = await PDFDocument.load(await monthlyReportPdf(sampleReport({
      repayments: [], totals: { ...sampleReport({}, 0).totals, activeMembers: 0, paidMembers: 0, unpaidMembers: 0, payments: 1, byMethod: [] },
    }, 0)))
    const text = await pageText(empty.getPage(0))
    expect(text).toContain('No contributions were received this month.')
    expect(text).toContain('No loan repayments were received in October 2026.')
    expect(text).toContain('0% of active members')
    expect(text).toContain('1 payment')

    const methods = ['Auto-pay', 'Online banking transfer', 'Cash in hand', 'Zelle', 'Check', 'Venmo', 'Other', 'Card']
    const many = sampleReport({}, 9)
    many.totals.byMethod = methods.map((method) => ({ method, cents: cents(2000), count: 1 }))
    many.totals.unpaidMembers = 0
    many.repayments.push({ ...many.repayments[0], method: 'Cash', receivedBy: 'Treasurer' })
    const wrapped = await pageText((await PDFDocument.load(await monthlyReportPdf(many))).getPage(0))
    expect(wrapped).toContain('Card $20.00 (1)')
    expect(wrapped).toContain('2 payments received')
  })

  it('draws the logo from the app’s file, and goes without it if the file is missing', async () => {
    const logo = await loadLogo()
    expect(logo.map((p) => p.d.slice(0, 1))).toEqual(['M', 'M'])
    expect(await loadLogo('/no/such/logo.svg')).toEqual([])
    expect(pdfText('Café “x” — y… ✓')).toBe('Café "x" - y... ?')
  })
})

describe('the download', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T18:00:00Z'))
    await resetDatabase()
    await createStaffFixtures()
    await createMember('MC-10001', { legalName: 'Ada Example' })
    await contribution('MC-10001', '2026-10-03', 2000, { paymentMethod: 'Zelle' })
  })
  afterEach(() => vi.useRealTimers())

  const get = (query: Record<string, string>) => callRoute('reports/monthly', 'GET', { query: new URLSearchParams(query).toString() })

  it('as JSON, PDF or CSV, for staff who can see contributions', async () => {
    signInAs('finance')
    const json = await get({})
    expect(json.status).toBe(200)
    expect(json.json).toMatchObject({ month: '2026-10', totals: { collectedCents: 2000 } })

    const pdf = await get({ month: '2026-10', format: 'pdf' })
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="Millionaires-Club-Monthly-Contributions-2026-10.pdf"')

    const csv = await get({ month: '2026-10', format: 'csv' })
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(csv.text).toContain('MC-10001,Ada Example,,')
  })

  it('refuses a month or format it does not know, and members', async () => {
    signInAs('finance')
    expect((await get({ month: '2026-11' })).json.error).toBe('month must be YYYY-MM, and not in the future.')
    expect((await get({ format: 'xlsx' })).json.error).toBe('format must be pdf, csv or json.')
    signInAsMember('MC-10001')
    expect((await get({})).status).toBe(403)
  })
})
