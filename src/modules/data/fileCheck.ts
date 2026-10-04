// A dry run of the club's data file (README "Real club data"): everything the
// seed would load, checked without touching a database. The seed writes
// record by record and skips a record whose key is already there, so a bad
// file either stops halfway or silently loses rows. This finds both first.
//
// Amounts must be whole cents: the ledger refuses anything else when it
// posts opening balances (fromLegacyDollars).
//
// Problems name records by their key (member ID, transaction ID, loan ID),
// never by a person's name, so the output can be shared with the developer.

import { cents, formatUSD } from '@/lib/money'

export type FieldSpec = {
  name: string
  kind: string // scalar | object | enum
  type: string // String | Int | Float | Boolean | DateTime | BigInt | ...
  isRequired: boolean
  hasDefaultValue: boolean
  isUpdatedAt?: boolean
}
/** The fields of each model, as `Prisma.dmmf.datamodel.models` lists them. */
export type ModelSpecs = ReadonlyArray<{ name: string; fields: readonly FieldSpec[] }>

export type Finding = { level: 'error' | 'warning'; section: string; record: string; message: string }

export type DataCheck = {
  errors: Finding[]
  warnings: Finding[]
  counts: Record<string, number>
  /** Figures the Treasurer compares with their own records (runbook Stage 2). */
  totals: { archiveLifetime: number; contributions: number; liveLoanBalances: number; activeHistoricalLoans: number }
}

type Section = { key: string; model: string; required: boolean; id: (r: any) => string | undefined }

// What the seed loads, in its order. Contribution.amountCents and Loan.lifecycle
// are worked out by the seed, so the file does not carry them.
const SECTIONS: Section[] = [
  { key: 'members', model: 'Member', required: true, id: (r) => r.id },
  { key: 'yearlyTotals', model: 'YearlyTotal', required: true, id: (r) => (r.memberId !== undefined ? `${r.memberId}/${r.year}` : undefined) },
  { key: 'contributions', model: 'Contribution', required: true, id: (r) => r.transactionId },
  { key: 'loans', model: 'Loan', required: true, id: (r) => r.loanId },
  { key: 'loanPayments', model: 'LoanPayment', required: true, id: (r) => r.paymentId },
  { key: 'historicalLoans', model: 'HistoricalLoan', required: false, id: (r) => r.loanId },
]
const SET_BY_SEED: Record<string, string[]> = { Contribution: ['amountCents'], Loan: ['lifecycle'] }

// Fields the app fills in itself once the data is loaded. A value in the file
// would skip the step that should produce it (a receipt number, a ledger
// posting, a Treasurer's review of an older loan).
const APP_OWNED: Record<string, string[]> = {
  Contribution: ['receiptNumber', 'receiptCovers', 'journalEntry', 'reversedAt', 'reversedBy', 'reversalReason', 'reversalEntry'],
  Loan: ['disbursementEntry', 'chargeOffEntry', 'servicedOn', 'delinquency'],
  LoanPayment: ['journalEntry', 'eventSeq'],
  HistoricalLoan: ['borrowerId', 'cosignerId', 'borrowerLink', 'cosignerLink', 'confirmedBalanceCents', 'balanceAsOf', 'balanceConfirmedBy', 'balanceConfirmedAt', 'importedLoanId'],
}

const LOAN_STATUSES = ['Active', 'Paid Off', 'Cancelled']
const HISTORICAL_STATUSES = ['Active', 'Paid Off']
const MEMBER_ID = /^MC-[0-9]+$/
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
const CENT = 0.005

const isDate = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !Number.isNaN(new Date(v).getTime())
const hasMoreThanCents = (n: number) => Math.abs(Math.round(n * 100) - n * 100) > 1e-6
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const money = (n: number) => formatUSD(cents(Math.round(n * 100)))

const TYPES: Record<string, [(v: unknown) => boolean, string]> = {
  String: [(v) => typeof v === 'string', 'should be text'],
  Int: [(v) => Number.isInteger(v), 'should be a whole number'],
  BigInt: [(v) => Number.isSafeInteger(v), 'should be a whole number'],
  Float: [(v) => typeof v === 'number' && Number.isFinite(v), 'should be a number'],
  Boolean: [(v) => typeof v === 'boolean', 'should be true or false'],
  DateTime: [isDate, 'should be a date'],
}

function typeProblem(f: FieldSpec, v: unknown): string | null {
  const check = TYPES[f.type]
  return check && !check[0](v) ? check[1] : null
}

/**
 * Check a data file (the parsed JSON) the way the seed would load it.
 * `historicalLoans` replaces the file's own list, as SEED_HISTORICAL_LOANS_FILE does.
 */
export function checkClubData(data: unknown, models: ModelSpecs, historicalLoans?: unknown): DataCheck {
  const findings: Finding[] = []
  const add = (level: Finding['level'], section: string, record: string, message: string) => findings.push({ level, section, record, message })
  const counts: Record<string, number> = {}
  const rows: Record<string, any[]> = {}
  // Each record is named by its key, or by its place in the list when it has none.
  const labels = new WeakMap<object, string>()
  const labelOf = (r: object) => labels.get(r)!

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    add('error', 'file', '-', 'is not a JSON object with members, contributions and loans')
    return finish(findings, counts, rows)
  }
  const file = { ...(data as Record<string, unknown>) }
  if (historicalLoans !== undefined) file.historicalLoans = historicalLoans

  for (const section of SECTIONS) {
    const list = file[section.key]
    if (list === undefined && !section.required) { rows[section.key] = []; continue }
    if (!Array.isArray(list)) {
      add('error', section.key, '-', list === undefined ? 'is missing' : 'should be a list')
      rows[section.key] = []
      continue
    }
    rows[section.key] = list
    counts[section.key] = list.length
    const spec = models.find((m) => m.name === section.model)!
    const fields = new Map(spec.fields.filter((f) => f.kind !== 'object').map((f) => [f.name, f]))
    const seen = new Set<string>()
    list.forEach((r, i) => {
      if (r === null || typeof r !== 'object' || Array.isArray(r)) {
        add('error', section.key, `#${i + 1}`, 'is not a record')
        return
      }
      const key = section.id(r)
      const label = typeof key === 'string' && key ? key : `#${i + 1}`
      labels.set(r, label)
      if (typeof key === 'string' && key) {
        if (seen.has(key)) add('error', section.key, label, 'appears more than once; the seed would keep only the first')
        seen.add(key)
      }
      for (const [name, value] of Object.entries(r)) {
        const f = fields.get(name)
        if (!f || SET_BY_SEED[section.model]?.includes(name)) {
          add('error', section.key, label, `has a field the app does not know: ${name}`)
          continue
        }
        if (APP_OWNED[section.model]?.includes(name) && value !== null) {
          add('error', section.key, label, `${name} is filled in by the app, not the data file`)
          continue
        }
        if (value === null) {
          if (f.isRequired) add('error', section.key, label, `${name} is empty`)
          continue
        }
        const problem = typeProblem(f, value)
        if (problem) add('error', section.key, label, `${name} ${problem}`)
      }
      for (const f of fields.values()) {
        if (f.isRequired && !f.hasDefaultValue && !f.isUpdatedAt && !SET_BY_SEED[section.model]?.includes(f.name) && !(f.name in r)) {
          add('error', section.key, label, `${f.name} is missing`)
        }
      }
    })
  }

  // Cross-checks between records (every record that is an object).
  const keyed = (key: string) => rows[key].filter((r) => r && typeof r === 'object' && !Array.isArray(r))
  const members = keyed('members')
  const memberIds = new Set(members.map((m) => m.id))
  const loansById = new Map(keyed('loans').map((l) => [l.loanId, l]))
  const notMember = (section: string, record: string, field: string, id: unknown) => {
    if (typeof id === 'string' && !memberIds.has(id)) add('error', section, record, `${field} ${id} is not a member in the file`)
  }
  const amount = (section: string, record: string, field: string, v: unknown, { positive = false } = {}) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    if (v < 0 || (positive && v === 0)) add('error', section, record, `${field} is ${money(v)}`)
    else if (hasMoreThanCents(v)) add('error', section, record, `${field} ${v} has fractions of a cent; the ledger takes whole cents only`)
  }
  const dates = (section: string, record: string, r: any, from: string, to: string) => {
    if (isDate(r[from]) && isDate(r[to]) && new Date(r[to]) < new Date(r[from])) add('warning', section, record, `${to} is before ${from}`)
  }
  const today = Date.now()
  const notFuture = (section: string, record: string, field: string, v: unknown) => {
    if (isDate(v) && new Date(v as string).getTime() > today) add('warning', section, record, `${field} is in the future`)
  }

  for (const m of members) {
    const id = labelOf(m)
    if (typeof m.id === 'string' && !MEMBER_ID.test(m.id)) add('warning', 'members', id, 'is not numbered like MC-1234; new members are numbered after the highest MC- number')
    if (typeof m.portalPassword === 'string' && !BCRYPT_HASH.test(m.portalPassword)) {
      add('error', 'members', id, 'portalPassword is not a bcrypt hash (it looks like a plain password)')
    }
    if (m.portalEnabled === true && !m.portalPassword) add('warning', 'members', id, 'portalEnabled is true but there is no portal password, so the member will have no access')
    for (const f of ['archiveLifetime', 'contributions2026', 'overallContributions', 'maxLoanAmount', 'currentLoanBalance']) amount('members', id, f, m[f])
    notFuture('members', id, 'joinDate', m.joinDate)
    const parts = [m.archiveLifetime ?? 0, m.contributions2026 ?? 0]
    if (typeof m.overallContributions === 'number' && parts.every((p) => typeof p === 'number') && Math.abs(m.overallContributions - sum(parts)) > CENT) {
      add('warning', 'members', id, `overallContributions ${money(m.overallContributions)} is not archiveLifetime + contributions2026 (${money(sum(parts))})`)
    }
  }

  const yearly = keyed('yearlyTotals')
  for (const y of yearly) {
    const label = labelOf(y)
    notMember('yearlyTotals', label, 'memberId', y.memberId)
    amount('yearlyTotals', label, 'amount', y.amount)
  }
  // The archive total should be the sum of the member's yearly totals.
  const byMember = new Map<string, number>()
  for (const y of yearly) if (typeof y.amount === 'number') byMember.set(y.memberId, (byMember.get(y.memberId) ?? 0) + y.amount)
  for (const m of members) {
    const years = byMember.get(m.id)
    if (years !== undefined && typeof m.archiveLifetime === 'number' && Math.abs(years - m.archiveLifetime) > CENT) {
      add('warning', 'members', labelOf(m), `archiveLifetime ${money(m.archiveLifetime)} is not the sum of its yearly totals (${money(years)})`)
    }
  }

  const contributions = keyed('contributions')
  for (const c of contributions) {
    const label = labelOf(c)
    notMember('contributions', label, 'memberId', c.memberId)
    amount('contributions', label, 'amount', c.amount, { positive: true })
    notFuture('contributions', label, 'paymentDate', c.paymentDate)
  }

  for (const l of loansById.values()) {
    const label = labelOf(l)
    notMember('loans', label, 'borrowerId', l.borrowerId)
    if (l.cosignerId != null) notMember('loans', label, 'cosignerId', l.cosignerId)
    if (l.cosignerId != null && l.cosignerId === l.borrowerId) add('error', 'loans', label, 'the co-signer is the borrower')
    amount('loans', label, 'loanAmount', l.loanAmount, { positive: true })
    for (const f of ['monthlyDue', 'totalPaid', 'balanceRemaining']) amount('loans', label, f, l[f])
    if (typeof l.status === 'string' && !LOAN_STATUSES.includes(l.status)) add('error', 'loans', label, `status "${l.status}" is not one of ${LOAN_STATUSES.join(', ')}`)
    if (l.status === 'Paid Off' && typeof l.balanceRemaining === 'number' && l.balanceRemaining > CENT) add('warning', 'loans', label, `is Paid Off but balanceRemaining is ${money(l.balanceRemaining)}`)
    if (l.status === 'Active' && l.balanceRemaining === 0) add('warning', 'loans', label, 'is Active but balanceRemaining is $0')
    dates('loans', label, l, 'loanDate', 'endDate')
    notFuture('loans', label, 'loanDate', l.loanDate)
  }

  const payments = keyed('loanPayments')
  const paidByLoan = new Map<string, number>()
  for (const p of payments) {
    const label = labelOf(p)
    const loan = loansById.get(p.loanId)
    if (typeof p.loanId === 'string' && !loan) add('error', 'loanPayments', label, `loanId ${p.loanId} is not a loan in the file`)
    notMember('loanPayments', label, 'borrowerId', p.borrowerId)
    if (loan && typeof p.borrowerId === 'string' && loan.borrowerId !== p.borrowerId) add('error', 'loanPayments', label, `borrowerId ${p.borrowerId} is not the borrower of ${p.loanId}`)
    amount('loanPayments', label, 'amount', p.amount, { positive: true })
    notFuture('loanPayments', label, 'paymentDate', p.paymentDate)
    if (typeof p.amount === 'number') paidByLoan.set(p.loanId, (paidByLoan.get(p.loanId) ?? 0) + p.amount)
  }
  for (const l of loansById.values()) {
    const paid = paidByLoan.get(l.loanId) ?? 0
    if (typeof l.totalPaid === 'number' && Math.abs(paid - l.totalPaid) > CENT) {
      add('warning', 'loans', labelOf(l), `totalPaid ${money(l.totalPaid)} is not the sum of its payments (${money(paid)})`)
    }
  }

  for (const h of keyed('historicalLoans')) {
    const label = labelOf(h)
    amount('historicalLoans', label, 'loanAmount', h.loanAmount, { positive: true })
    for (const f of ['totalPaid', 'balanceRemaining']) amount('historicalLoans', label, f, h[f])
    if (typeof h.status === 'string' && !HISTORICAL_STATUSES.includes(h.status)) add('error', 'historicalLoans', label, `status "${h.status}" is not one of ${HISTORICAL_STATUSES.join(', ')}`)
    if (typeof h.borrowerName === 'string' && !h.borrowerName.trim()) add('error', 'historicalLoans', label, 'borrowerName is empty')
    dates('historicalLoans', label, h, 'loanDate', 'endDate')
  }

  return finish(findings, counts, rows)
}

function finish(findings: Finding[], counts: Record<string, number>, rows: Record<string, any[]>): DataCheck {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const list = (k: string) => (rows[k] ?? []).filter((r) => r && typeof r === 'object')
  const total = (xs: number[]) => sum(xs.map((x) => Math.round(x * 100))) / 100
  return {
    errors: findings.filter((f) => f.level === 'error'),
    warnings: findings.filter((f) => f.level === 'warning'),
    counts,
    totals: {
      archiveLifetime: total(list('members').map((m) => num(m.archiveLifetime))),
      contributions: total(list('contributions').map((c) => num(c.amount))),
      liveLoanBalances: total(list('loans').filter((l) => l.status === 'Active').map((l) => num(l.balanceRemaining))),
      activeHistoricalLoans: list('historicalLoans').filter((h) => h.status === 'Active').length,
    },
  }
}

/** The report, as the command prints it. At most `perKind` lines of each problem. */
export function formatDataCheck(check: DataCheck, perKind = 20): string {
  const out: string[] = []
  const counts = Object.entries(check.counts).map(([k, n]) => `${k} ${n}`).join(', ')
  out.push(`Records: ${counts || 'none'}`)
  out.push(`Totals: archive ${money(check.totals.archiveLifetime)}, contributions ${money(check.totals.contributions)}, live loan balances ${money(check.totals.liveLoanBalances)}, older loans marked Active ${check.totals.activeHistoricalLoans}`)
  for (const [title, list] of [['Errors (the seed refuses the file)', check.errors], ['Warnings (check against your records)', check.warnings]] as const) {
    if (!list.length) continue
    out.push('', `${title}: ${list.length}`)
    const kinds = new Map<string, Finding[]>()
    for (const f of list) {
      // Problems of one kind differ only in their IDs and figures.
      const kind = `${f.section}: ${f.message.replace(/\S*\d\S*/g, '…')}`
      kinds.set(kind, [...(kinds.get(kind) ?? []), f])
    }
    for (const group of kinds.values()) {
      for (const f of group.slice(0, perKind)) out.push(`  ${f.section} ${f.record}: ${f.message}`)
      if (group.length > perKind) out.push(`  … and ${group.length - perKind} more like this`)
    }
  }
  out.push('', check.errors.length ? `✗ ${check.errors.length} errors: fix the file before loading it.` : `✓ No errors${check.warnings.length ? `; ${check.warnings.length} warnings to check` : ''}. The file can be loaded.`)
  return out.join('\n')
}
