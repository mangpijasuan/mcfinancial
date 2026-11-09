// Bulk Upload (docs/operations/data-import.md): loan repayments recorded
// from a spreadsheet, and reversals of mistaken contributions, which are
// each sent for approval. Members and contributions are in data-import.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseFixtures, createLoan, createMember, recordBankBalance } from './helpers/factories'
import { TEST_IDS, signInAs, signInAsMember, staffId } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { callRoute } from './helpers/routes'
import { fileHash } from '@/modules/data/import'

const A = TEST_IDS.member
const csv = (...lines: string[]) => lines.join('\r\n') + '\r\n'
const REPAYMENTS = (...rows: string[]) => csv('Loan ID,Paid on,Amount,Method,Received by,Note', ...rows)
const REVERSALS = (...rows: string[]) => csv('Receipt,Reason', ...rows)
let lastId: bigint
const audits = (action: string) => prisma.auditLog.count({ where: { action, id: { gt: lastId } } })

const preview = (path: string, file: string) => callRoute(`data/import/${path}/preview`, 'POST', { body: { csv: file } })
const upload = (path: string, file: string) => callRoute(`data/import/${path}`, 'POST', { body: { csv: file, fileHash: fileHash(file), fileName: 'upload.csv' } })

async function setToday(date: string) {
  vi.setSystemTime(new Date(`${date}T18:00:00Z`))
  await prisma.staffSession.updateMany({ data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) } })
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-15T18:00:00Z'))
  await resetDatabase()
  await createBaseFixtures()
  lastId = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0)
})
afterEach(() => vi.useRealTimers())

describe('loan repayments', () => {
  it('records each one like a repayment typed in, all at once, audited', async () => {
    signInAs('finance')
    const file = REPAYMENTS('ln-test-a,2026-01-05,100,Zelle,Fin,first', 'LN-TEST-A,1/10/2026,$50.00,,,', 'LN-TEST-B,2026-01-12,25,Cash,,')
    const p = await preview('loan-payments', file)
    expect(p.status).toBe(200)
    expect(p.json.counts).toEqual({ add: 3, update: 0, unchanged: 0, error: 0, warnings: 0 })
    expect(p.json.rows[0].summary).toBe(`LN-TEST-A · Test Member ${A} · 100 · 2026-01-05`)
    expect(await prisma.loanPayment.count()).toBe(0)

    const res = await upload('loan-payments', file)
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ added: 3, updated: 0 })
    const loan = await prisma.loan.findUniqueOrThrow({ where: { loanId: 'LN-TEST-A' } })
    expect(loan).toMatchObject({ totalPaid: 150, balanceRemaining: 850 })
    const payments = await prisma.loanPayment.findMany({ where: { loanId: 'LN-TEST-A' }, orderBy: { paymentDate: 'asc' } })
    expect(payments.map((x) => [x.amount, x.source, x.paymentMethod, x.comments])).toEqual([[100, 'Import', 'Zelle', 'first'], [50, 'Import', null, null]])
    expect(await audits('loan_payment.create')).toBe(3)
    expect(await audits('data.import')).toBe(1)
    expect(await prisma.dataImport.findFirstOrThrow()).toMatchObject({ kind: 'loan_payments', added: 3, importedBy: expect.any(String) })

    // The same file again is refused.
    expect((await upload('loan-payments', file)).json.error).toMatch(/already imported/)
  })

  it('refuses rows it cannot record, and then records nothing', async () => {
    await createLoan('LN-GONE', A, { lifecycle: 'cancelled', status: 'Cancelled' })
    signInAs('finance')
    const p = await preview('loan-payments', REPAYMENTS(
      ',2026-01-05,10', 'LN-NONE,2026-01-05,10', 'LN-GONE,2026-01-05,10',
      'LN-TEST-A,,10', 'LN-TEST-A,yesterday,10', 'LN-TEST-A,2026-02-01,10',
      'LN-TEST-A,2026-01-05,', 'LN-TEST-A,2026-01-05,ten', 'LN-TEST-A,2026-01-05,0',
    ))
    expect(p.json.rows.map((r: any) => r.errors)).toEqual([
      ['Loan ID is empty.'], ['There is no loan LN-NONE.'], ['This loan was cancelled.'],
      ['Paid on is empty.'], ['"yesterday" is not a date: use YYYY-MM-DD or M/D/YYYY.'], ['The payment date is in the future.'],
      ['Amount is empty.'], ['"ten" is not an amount in dollars and cents.'], ['The amount must be more than $0.'],
    ])
    expect(p.json.rows[0].summary).toBe('(no loan) · 10 · 2026-01-05')
    expect(p.json.rows[6].summary).toBe(`LN-TEST-A · Test Member ${A} · (no amount) · 2026-01-05`)
    expect(p.json.rows[3].summary).toBe(`LN-TEST-A · Test Member ${A} · 10 · (no date)`)
    const res = await upload('loan-payments', REPAYMENTS('LN-TEST-A,2026-01-05,10', 'LN-NONE,2026-01-05,10'))
    expect(res.status).toBe(409)
    expect(await prisma.loanPayment.count()).toBe(0)
  })

  it('warns about repayments over the balance, already recorded, or twice in the file', async () => {
    await prisma.loanPayment.create({ data: { paymentId: 'LP-OLD', loanId: 'LN-TEST-A', borrowerId: A, borrowerName: 'x', paymentDate: new Date('2026-01-02'), amount: 100 } })
    signInAs('finance')
    const p = await preview('loan-payments', REPAYMENTS(
      'LN-TEST-A,2026-01-02,100', 'LN-TEST-A,2026-01-03,20', 'LN-TEST-A,2026-01-03,20',
      'LN-TEST-B,2026-01-04,1200', 'LN-TEST-A,2026-01-05,900',
    ))
    expect(p.json.counts.error).toBe(0)
    expect(p.json.rows.map((r: any) => r.warnings)).toEqual([
      ['Looks already recorded: LP-OLD has the same loan, date and amount.'],
      [],
      ['Same loan, date and amount as line 3.'],
      ['More than the $1,000.00 still owed on LN-TEST-B.'],
      ['More than the $1,000.00 still owed on LN-TEST-A, with the earlier rows for it in this file.'],
    ])
  })

  it('on the loan engine, refuses more than pays the loan off, counting the file’s earlier rows', async () => {
    const loanId = await engineLoanPaidOut()
    signInAs('finance')
    const over = await preview('loan-payments', REPAYMENTS(`${loanId},2026-01-15,1000.01`))
    expect(over.json.rows[0].errors).toEqual([`That is more than the $1,000.00 needed to pay ${loanId} off.`])
    const twice = await preview('loan-payments', REPAYMENTS(`${loanId},2026-01-15,600`, `${loanId},2026-01-15,400.01`))
    expect(twice.json.rows.map((r: any) => r.errors)).toEqual([[], [`That is more than the $1,000.00 needed to pay ${loanId} off, with the earlier rows for it in this file.`]])

    const file = REPAYMENTS(`${loanId},2026-01-15,600`, `${loanId},2026-01-15,400`)
    expect((await upload('loan-payments', file)).status).toBe(201)
    expect(await prisma.loan.findUniqueOrThrow({ where: { loanId } })).toMatchObject({ lifecycle: 'paid_off' })
    // Paid off: a further repayment is refused.
    expect((await preview('loan-payments', REPAYMENTS(`${loanId},2026-01-15,1`))).json.rows[0].errors).toEqual(['This loan is already paid off.'])
  })

  it('needs its columns', async () => {
    signInAs('finance')
    expect((await preview('loan-payments', csv('Loan,Amount', 'LN-TEST-A,10'))).json.error).toBe('The file needs a column named "Paid on" in its first row.')
    expect((await preview('loan-payments', csv('Paid on', '2026-01-05'))).json.error).toBe('The file needs columns named "Loan ID" and "Amount" in its first row.')
  })
})

describe('contribution reversals', () => {
  async function paid(memberId: string, amount: number) {
    signInAs('finance')
    const res = await callRoute('contributions', 'POST', { body: { memberId, amount, paymentDate: '2026-01-10', paymentMethod: 'Cash' } })
    expect(res.status).toBe(201)
    return res.json as { transactionId: string; receiptNumber: string }
  }

  it('sends each reversal for approval, and reverses nothing until approved', async () => {
    const one = await paid(A, 20)
    const two = await paid(A, 40)
    signInAs('finance')
    const file = REVERSALS(`${one.receiptNumber.toLowerCase()},Recorded twice`, `${two.transactionId},Wrong member`)
    const p = await preview('contribution-reversals', file)
    expect(p.json.counts).toMatchObject({ add: 2, error: 0 })
    expect(p.json.rows[0].summary).toBe(`${one.receiptNumber} · Test Member ${A} (${A}) · $20.00 paid 2026-01-10`)

    const res = await upload('contribution-reversals', file)
    expect(res.status).toBe(201)
    expect(res.json.added).toBe(2)
    const requests = await Promise.all([one, two].map((c) => prisma.approvalRequest.findFirstOrThrow({ where: { action: 'contribution.reverse', entityId: c.transactionId } })))
    expect(requests.map((r) => [r.entityId, r.status, r.requestedBy, Number(r.amountCents)])).toEqual([
      [one.transactionId, 'pending', staffId('finance'), 2000], [two.transactionId, 'pending', staffId('finance'), 4000],
    ])
    expect(requests[0].summary).toBe(`Reverse ${one.receiptNumber} · Test Member ${A} (${A}) · $20.00 paid 2026-01-10. Reason: Recorded twice (bulk upload ${res.json.publicId})`)
    expect(await prisma.contribution.count({ where: { reversedAt: { not: null } } })).toBe(0)
    expect(await audits('approval.request')).toBe(2)
    expect(await audits('data.import')).toBe(1)

    // The Treasurer approves one: only then is it reversed.
    signInAs('treasurer')
    expect((await callRoute('approvals/[id]/approve', 'POST', { params: { id: requests[0].id }, body: {} })).json).toMatchObject({ status: 'approved' })
    expect(await prisma.contribution.findUniqueOrThrow({ where: { transactionId: one.transactionId } })).toMatchObject({ reversalReason: 'Recorded twice', reversedBy: staffId('finance') })

    // Pending or reversed: a second upload is refused, row by row.
    signInAs('finance')
    const again = await preview('contribution-reversals', REVERSALS(`${one.receiptNumber},x`, `${two.receiptNumber},x`))
    expect(again.json.rows.map((r: any) => r.errors)).toEqual([
      ['This contribution has already been reversed.'],
      [`Its reversal is already waiting for approval (${requests[1].publicId}).`],
    ])
  })

  it('refuses rows it cannot send', async () => {
    const one = await paid(A, 20)
    signInAs('finance')
    const p = await preview('contribution-reversals', REVERSALS(
      ',Recorded twice', 'RC-NONE,Recorded twice', `${one.receiptNumber},`, `${one.receiptNumber},${'x'.repeat(501)}`, `${one.transactionId},Recorded twice`,
    ))
    expect(p.json.rows.map((r: any) => r.errors)).toEqual([
      ['Receipt is empty.'],
      ['There is no contribution with the receipt or number RC-NONE.'],
      ['Give a reason for the reversal.'],
      ['The same contribution is on line 4.', 'The reason is longer than 500 characters.'],
      ['The same contribution is on line 5.'],
    ])
    expect(p.json.rows[0].summary).toBe('(no receipt)')
    expect(p.json.rows[1].summary).toBe('RC-NONE')
    expect((await upload('contribution-reversals', REVERSALS(`${one.receiptNumber},`))).status).toBe(409)
    expect(await prisma.approvalRequest.count()).toBe(0)
  })

  it('finds a contribution recorded before receipts existed by its number', async () => {
    await prisma.contribution.create({ data: { transactionId: 'CON-OLD-1', memberId: A, memberName: 'Old', paymentDate: new Date('2025-06-01'), monthYear: 'Jun-2025', amount: 20, amountCents: BigInt(2000) } })
    signInAs('finance')
    const p = await preview('contribution-reversals', REVERSALS('con-old-1,Entered in error'))
    expect(p.json.rows[0]).toMatchObject({ action: 'add', summary: `CON-OLD-1 · Old (${A}) · $20.00 paid 2025-06-01` })
  })
})

describe('who may upload', () => {
  it('only staff who may record repayments or propose reversals', async () => {
    const file = REPAYMENTS('LN-TEST-A,2026-01-05,10')
    signInAs('auditor')
    expect((await preview('loan-payments', file)).status).toBe(403)
    expect((await preview('contribution-reversals', REVERSALS('RC-1,x'))).status).toBe(403)
    signInAsMember(A)
    expect((await upload('loan-payments', file)).status).toBe(403)
  })
})

// A loan on the loan engine, approved, signed and paid out on 2026-01-15.
async function engineLoanPaidOut() {
  const BORROWER = 'MC-BULK-B'
  const COSIGNER = 'MC-BULK-C'
  await createMember(BORROWER, { monthsActive: 24, archiveLifetime: 2000, contributions2026: 180 })
  await createMember(COSIGNER, { monthsActive: 24, archiveLifetime: 2000 })
  await setToday('2026-01-15')
  await recordBankBalance(50_000_00, '2026-01-15')
  signInAs('admin')
  const created = await callRoute('loans', 'POST', { body: { borrowerId: BORROWER, cosignerId: COSIGNER, loanAmount: '1000', termMonths: 3, loanDate: '2026-01-15' } })
  expect(created.status).toBe(201)
  const loanId = created.json.loanId as string
  const { agreementId } = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
  signInAsMember(BORROWER)
  expect((await callRoute('agreements/[id]', 'PATCH', {
    params: { id: agreementId }, body: { signerType: 'borrower', signatureText: 'Test Member', borrowerAddress: '1 Main St', borrowerCity: 'Tulsa', borrowerState: 'OK' },
  })).status).toBe(200)
  signInAsMember(COSIGNER)
  expect((await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { signerType: 'cosigner', signatureText: 'Co Signer' } })).status).toBe(200)
  signInAs('treasurer')
  expect((await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { signerType: 'lender', signatureText: 'Tess Treasurer' } })).status).toBe(200)
  expect((await callRoute('loans/[id]/disburse', 'POST', { params: { id: loanId }, body: { disbursedOn: '2026-01-15', method: 'Zelle', reference: 'ZL-1' } })).status).toBe(200)
  return loanId
}
