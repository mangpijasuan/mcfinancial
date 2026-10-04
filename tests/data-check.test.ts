// The dry run of the club's data file (npm run data:check; the seed runs it
// too and loads nothing from a file with errors).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { checkClubData, formatDataCheck, type ModelSpecs } from '@/modules/data/fileCheck'

const models: ModelSpecs = Prisma.dmmf.datamodel.models
const HASH = '$2a$10$' + 'a'.repeat(53)

function goodFile() {
  return {
    members: [
      { id: 'MC-0001', legalName: 'Member One', joinDate: '2019-01-01', archiveLifetime: 240, contributions2026: 20, overallContributions: 260, portalEnabled: true, portalPassword: HASH },
      { id: 'MC-0002', legalName: 'Member Two', joinDate: '2020-01-01', archiveLifetime: 0 },
    ],
    yearlyTotals: [{ memberId: 'MC-0001', year: 2025, amount: 240 }],
    contributions: [{ transactionId: 'CON-1', memberId: 'MC-0001', memberName: 'Member One', paymentDate: '2026-01-15', monthYear: 'Jan-2026', amount: 20 }],
    loans: [{ loanId: 'L1', borrowerId: 'MC-0001', borrowerName: 'Member One', cosignerId: 'MC-0002', loanDate: '2026-01-05', endDate: '2026-07-05', termMonths: 6, loanAmount: 1200, monthlyDue: 200, totalPaid: 200, balanceRemaining: 1000, status: 'Active' }],
    loanPayments: [{ paymentId: 'P1', loanId: 'L1', borrowerId: 'MC-0001', borrowerName: 'Member One', paymentDate: '2026-02-05', amount: 200 }],
    historicalLoans: [{ loanId: 'H1', year: 2024, borrowerName: 'Member One', loanDate: '2024-01-01', loanAmount: 1000, balanceRemaining: 300, status: 'Active' }],
  }
}
const messages = (f: ReturnType<typeof checkClubData>['errors']) => f.map((x) => `${x.section} ${x.record}: ${x.message}`)

describe('a good file', () => {
  it('passes, with the counts and totals the Treasurer compares', () => {
    const check = checkClubData(goodFile(), models)
    expect(check.errors).toEqual([])
    expect(check.warnings).toEqual([])
    expect(check.counts).toEqual({ members: 2, yearlyTotals: 1, contributions: 1, loans: 1, loanPayments: 1, historicalLoans: 1 })
    expect(check.totals).toEqual({ archiveLifetime: 240, contributions: 20, liveLoanBalances: 1000, activeHistoricalLoans: 1 })
    expect(formatDataCheck(check)).toContain('✓ No errors. The file can be loaded.')
  })

  it('may leave out the older loans, or have them from a second file', () => {
    const { historicalLoans: _, ...file } = goodFile()
    expect(checkClubData(file, models).counts).not.toHaveProperty('historicalLoans')
    expect(checkClubData(file, models, [{ loanId: 'H9', year: 2023, borrowerName: 'X', loanDate: '2023-01-01', loanAmount: 500, status: 'Paid Off' }]).counts.historicalLoans).toBe(1)
  })

  it('the demo data passes', () => {
    const demo = JSON.parse(readFileSync(path.join(__dirname, '../prisma/demo-data.json'), 'utf8'))
    expect(checkClubData(demo, models).errors).toEqual([])
  })
})

describe('errors: the seed would fail or lose data', () => {
  it('a file that is not the club data shape', () => {
    for (const bad of [null, [], 'text']) expect(messages(checkClubData(bad, models).errors)).toEqual(['file -: is not a JSON object with members, contributions and loans'])
    const check = checkClubData({ members: {}, historicalLoans: 'x' }, models)
    expect(messages(check.errors)).toEqual([
      'members -: should be a list', 'yearlyTotals -: is missing', 'contributions -: is missing',
      'loans -: is missing', 'loanPayments -: is missing', 'historicalLoans -: should be a list',
    ])
    expect(check.totals).toEqual({ archiveLifetime: 0, contributions: 0, liveLoanBalances: 0, activeHistoricalLoans: 0 })
  })

  it('records with missing, unknown, empty or mistyped fields', () => {
    const file: any = goodFile()
    file.members.push('not a record', { legalName: 'No ID', joinDate: 'someday', monthsActive: 1.5, portalEnabled: 'yes', nickname: null, legalNameX: 'typo' })
    file.members.push({ id: 'MC-0003', legalName: null, joinDate: '2021-01-01', archiveLifetime: 'lots' })
    file.contributions.push({ transactionId: 'CON-2', memberId: 'MC-0001', memberName: 'Member One', paymentDate: '2026-02-15', monthYear: 'Feb-2026', amount: 20, amountCents: 2000, receiptNumber: 'RC-2026-000001', journalEntry: null })
    file.loans[0].lifecycle = 'disbursed'
    file.loans[0].principalCents = 1.5
    file.historicalLoans[0].borrowerId = 'MC-0001'
    expect(messages(checkClubData(file, models).errors)).toEqual([
      'members #3: is not a record',
      'members #4: joinDate should be a date',
      'members #4: monthsActive should be a whole number',
      'members #4: portalEnabled should be true or false',
      'members #4: has a field the app does not know: legalNameX',
      'members #4: id is missing',
      'members MC-0003: legalName is empty',
      'members MC-0003: archiveLifetime should be a number',
      'contributions CON-2: has a field the app does not know: amountCents',
      'contributions CON-2: receiptNumber is filled in by the app, not the data file',
      'loans L1: has a field the app does not know: lifecycle',
      'loans L1: principalCents should be a whole number',
      'historicalLoans H1: borrowerId is filled in by the app, not the data file',
    ])
  })

  it('a record twice: the seed keeps only the first', () => {
    const file: any = goodFile()
    file.contributions.push({ ...file.contributions[0], amount: 40 })
    file.yearlyTotals.push({ ...file.yearlyTotals[0] }, { year: 2024, amount: 0 })
    expect(messages(checkClubData(file, models).errors)).toEqual([
      'yearlyTotals MC-0001/2025: appears more than once; the seed would keep only the first',
      'yearlyTotals #3: memberId is missing',
      'contributions CON-1: appears more than once; the seed would keep only the first',
    ])
  })

  it('records pointing at members or loans that are not in the file', () => {
    const file: any = goodFile()
    file.yearlyTotals.push({ memberId: 'MC-0404', year: 2025, amount: 10 })
    file.contributions[0].memberId = 'MC-0404'
    file.loans.push({ ...file.loans[0], loanId: 'L2', borrowerId: 'MC-0404', cosignerId: 'MC-0405', totalPaid: 0 }, { ...file.loans[0], loanId: 'L3', cosignerId: 'MC-0001', totalPaid: 0 })
    file.loanPayments.push({ ...file.loanPayments[0], paymentId: 'P2', loanId: 'L9' }, { ...file.loanPayments[0], paymentId: 'P3', borrowerId: 'MC-0002', amount: 0.01 })
    file.loans[0].totalPaid = 200.01
    expect(messages(checkClubData(file, models).errors)).toEqual([
      'yearlyTotals MC-0404/2025: memberId MC-0404 is not a member in the file',
      'contributions CON-1: memberId MC-0404 is not a member in the file',
      'loans L2: borrowerId MC-0404 is not a member in the file',
      'loans L2: cosignerId MC-0405 is not a member in the file',
      'loans L3: the co-signer is the borrower',
      'loanPayments P2: loanId L9 is not a loan in the file',
      'loanPayments P3: borrowerId MC-0002 is not the borrower of L1',
    ])
  })

  it('amounts the ledger cannot take, statuses it does not know, plain-text passwords', () => {
    const file: any = goodFile()
    file.members[1].portalPassword = 'hunter22'
    file.members[1].maxLoanAmount = -5
    file.contributions[0].amount = 0
    file.loans[0].monthlyDue = 200.005
    file.loans[0].status = 'Defaulted'
    file.loans[0].cosignerId = null
    file.historicalLoans[0].status = 'Written off'
    file.historicalLoans[0].borrowerName = ' '
    expect(messages(checkClubData(file, models).errors)).toEqual([
      'members MC-0002: portalPassword is not a bcrypt hash (it looks like a plain password)',
      'members MC-0002: maxLoanAmount is -$5.00',
      'contributions CON-1: amount is $0.00',
      'loans L1: monthlyDue 200.005 has fractions of a cent; the ledger takes whole cents only',
      'loans L1: status "Defaulted" is not one of Active, Paid Off, Cancelled',
      'historicalLoans H1: status "Written off" is not one of Active, Paid Off',
      'historicalLoans H1: borrowerName is empty',
    ])
  })
})

describe('warnings: loads, but check against your records', () => {
  it('figures that disagree, odd dates and IDs, access without a password', () => {
    const file: any = goodFile()
    file.members[0].overallContributions = 300
    file.members[0].archiveLifetime = 250
    file.members.push({ id: 'M-2', legalName: 'Odd ID', joinDate: '2999-01-01', portalEnabled: true })
    file.loans[0].endDate = '2025-12-01'
    file.loans[0].totalPaid = 400
    file.loans.push({ ...file.loans[0], loanId: 'L2', loanDate: '2999-01-01', endDate: null, status: 'Paid Off', balanceRemaining: 50, totalPaid: 0 })
    file.loans.push({ ...file.loans[0], loanId: 'L3', status: 'Active', balanceRemaining: 0, totalPaid: 0, endDate: null })
    delete file.loans[0].cosignerId
    file.contributions[0].paymentDate = '2999-01-01'
    file.loanPayments[0].paymentDate = '2999-01-01'
    file.historicalLoans[0].endDate = '2023-01-01'
    const check = checkClubData(file, models)
    expect(messages(check.errors)).toEqual([])
    expect(messages(check.warnings)).toEqual([
      'members MC-0001: overallContributions $300.00 is not archiveLifetime + contributions2026 ($270.00)',
      'members M-2: is not numbered like MC-1234; new members are numbered after the highest MC- number',
      'members M-2: portalEnabled is true but there is no portal password, so the member will have no access',
      'members M-2: joinDate is in the future',
      'members MC-0001: archiveLifetime $250.00 is not the sum of its yearly totals ($240.00)',
      'contributions CON-1: paymentDate is in the future',
      'loans L1: endDate is before loanDate',
      'loans L2: is Paid Off but balanceRemaining is $50.00',
      'loans L2: loanDate is in the future',
      'loans L3: is Active but balanceRemaining is $0',
      'loanPayments P1: paymentDate is in the future',
      'loans L1: totalPaid $400.00 is not the sum of its payments ($200.00)',
      'historicalLoans H1: endDate is before loanDate',
    ])
    expect(formatDataCheck(check)).toContain('✓ No errors; 13 warnings to check. The file can be loaded.')
  })

  it('leaves figures alone where a part is missing or not a number', () => {
    const file: any = goodFile()
    file.members[0].contributions2026 = 'x'
    delete file.members[0].overallContributions
    file.yearlyTotals.push({ memberId: 'MC-0002', year: 2025, amount: 'x' })
    file.loanPayments[0].amount = 'x'
    file.loans[0].totalPaid = 'x'
    const check = checkClubData(file, models)
    expect(messages(check.warnings)).toEqual([])
    expect(check.totals.archiveLifetime).toBe(240)
  })
})

describe('the report', () => {
  it('groups problems of one kind and shows at most a few of each', () => {
    const file: any = goodFile()
    for (let i = 0; i < 4; i++) file.contributions.push({ ...file.contributions[0], transactionId: `CON-X${i}`, memberId: `MC-09${i}` })
    file.members[1].portalPassword = 'plain'
    const text = formatDataCheck(checkClubData(file, models), 2)
    expect(text).toContain('Errors (the seed refuses the file): 5')
    expect(text).toContain('  contributions CON-X0: memberId MC-090 is not a member in the file\n  contributions CON-X1: memberId MC-091 is not a member in the file\n  … and 2 more like this')
    expect(text).toContain('  members MC-0002: portalPassword is not a bcrypt hash')
    expect(text).toContain('✗ 5 errors: fix the file before loading it.')
    expect(text).not.toContain('Member One')
    expect(formatDataCheck(checkClubData(null, models))).toContain('Records: none')
  })

  it('a field type the check does not know is taken as it is', () => {
    const custom: ModelSpecs = models.map((m) => (m.name === 'Member' ? { ...m, fields: [...m.fields, { name: 'extra', kind: 'scalar', type: 'Json', isRequired: false, hasDefaultValue: false }] } : m))
    const file: any = goodFile()
    file.members[0].extra = { any: 'thing' }
    expect(checkClubData(file, custom).errors).toEqual([])
  })
})
