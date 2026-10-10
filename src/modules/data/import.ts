// Importing members and contributions from a spreadsheet saved as CSV
// (docs/operations/data-import.md).
//
// Always two steps: a preview that saves nothing and says, row by row, what
// would be added, changed or refused; then the import, which checks the
// file again and saves all of it in one transaction, or none of it. The
// same file cannot be imported twice. Members' money figures are never
// imported: contributions go through the same recording path as one typed
// in by hand (receipt, dues, ledger), and a member's totals follow from them.
import { createHash } from 'node:crypto'
import { MoneyError, cents, parseDollars, toLegacyDollars } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { nextPublicId } from '@/lib/publicIds'
import { recordContribution } from '@/lib/paymentActions'
import { recordAudit, type AuditContext } from '@/modules/audit'
import { allocateMemberId } from '@/modules/membership/numbers'
import { CsvError, cellText, headerKey, parseCsv } from './csv'

export type ImportKind = 'members' | 'contributions'
export const MAX_IMPORT_BYTES = 1024 * 1024
export const MAX_IMPORT_ROWS = 2000

export class ImportError extends Error {}

export type RowResult = {
  /** The row's line in the file (the header is line 1). */
  line: number
  action: 'add' | 'update' | 'unchanged' | 'error'
  summary: string
  /** What would change, field by field (members). */
  changes?: { field: string; from: string | null; to: string }[]
  errors: string[]
  warnings: string[]
}

export type ImportPreview = {
  kind: ImportKind
  fileHash: string
  rows: RowResult[]
  ignoredColumns: string[]
  counts: { add: number; update: number; unchanged: number; error: number; warnings: number }
  alreadyImported: { publicId: string; at: Date } | null
}

/** Columns each import understands, by their loose header key, with the names people use. */
const COLUMNS = {
  members: {
    memberId: ['memberid', 'id'],
    legalName: ['legalname', 'name', 'fullname'],
    nickname: ['nickname'],
    joinDate: ['joined', 'joindate', 'membersince'],
    phoneNo: ['phone', 'phoneno', 'phonenumber'],
    email: ['email', 'emailaddress'],
    beneficiary: ['beneficiary'],
  },
  contributions: {
    memberId: ['memberid', 'id'],
    paymentDate: ['paidon', 'paymentdate', 'date'],
    amount: ['amount'],
    paymentMethod: ['method', 'paymentmethod'],
    category: ['kind', 'category', 'type'],
    receivedBy: ['receivedby'],
    comments: ['note', 'notes', 'comments', 'reference'],
  },
} as const

/** The columns a member update may change. Name, join date and status are changed in the app, one member at a time. */
const MEMBER_CONTACT_FIELDS = ['nickname', 'phoneNo', 'email', 'beneficiary'] as const
const FIELD_LABELS: Record<string, string> = { nickname: 'Nickname', phoneNo: 'Phone', email: 'Email', beneficiary: 'Beneficiary' }

export const fileHash = (csv: string) => createHash('sha256').update(csv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')).digest('hex')

/** A calendar date, YYYY-MM-DD or M/D/YYYY (US), as midnight UTC like the app's forms. */
export function parseImportDate(text: string): Date | null {
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (us) [y, m, d] = [Number(us[3]), Number(us[1]), Number(us[2])]
  else return null
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Parsed = { header: string[]; columns: Record<string, number>; ignored: string[]; records: { line: number; cells: string[] }[] }

function readFile(kind: ImportKind, csv: string): Parsed {
  if (Buffer.byteLength(csv, 'utf8') > MAX_IMPORT_BYTES) throw new ImportError('The file is larger than 1 MB. Split it into smaller files.')
  let rows: string[][]
  try {
    rows = parseCsv(csv)
  } catch (err) {
    throw new ImportError((err as CsvError).message)
  }
  if (rows.length === 0) throw new ImportError('The file is empty.')
  const [header, ...data] = rows
  if (data.length > MAX_IMPORT_ROWS) throw new ImportError(`The file has ${data.length} rows; the most at once is ${MAX_IMPORT_ROWS}. Split it into smaller files.`)
  const columns: Record<string, number> = {}
  const ignored: string[] = []
  header.forEach((h, i) => {
    const key = headerKey(h)
    const field = Object.entries(COLUMNS[kind]).find(([, names]) => (names as readonly string[]).includes(key))?.[0]
    if (field && columns[field] === undefined) columns[field] = i
    else if (h.trim()) ignored.push(h.trim())
  })
  const required = kind === 'members' ? ['legalName'] : ['memberId', 'paymentDate', 'amount']
  const missing = required.filter((f) => columns[f] === undefined)
  if (missing.length) {
    const names: Record<string, string> = { legalName: 'Legal name', memberId: 'Member ID', paymentDate: 'Paid on', amount: 'Amount' }
    throw new ImportError(`The file needs ${missing.length === 1 ? 'a column' : 'columns'} named ${missing.map((f) => `"${names[f]}"`).join(' and ')} in its first row.`)
  }
  // Data rows are counted from line 2: the header is line 1 (blank lines are not counted).
  return { header, columns, ignored, records: data.map((cells, i) => ({ line: i + 2, cells })) }
}

const get = (p: Parsed, cells: string[], field: string) => (p.columns[field] === undefined ? '' : cellText(cells[p.columns[field]]))

function summarize(kind: ImportKind, hash: string, rows: RowResult[], ignored: string[], already: ImportPreview['alreadyImported']): ImportPreview {
  const count = (a: RowResult['action']) => rows.filter((r) => r.action === a).length
  return {
    kind, fileHash: hash, rows, ignoredColumns: ignored, alreadyImported: already,
    counts: { add: count('add'), update: count('update'), unchanged: count('unchanged'), error: count('error'), warnings: rows.reduce((n, r) => n + r.warnings.length, 0) },
  }
}

type MemberPlan = { line: number; id: string | null; create?: { legalName: string; joinDate: Date; nickname: string | null; phoneNo: string | null; email: string | null; beneficiary: string | null }; update?: Record<string, string> }

async function planMembers(p: Parsed, canUpdate: boolean) {
  const members = await prisma.member.findMany({ select: { id: true, legalName: true, nickname: true, phoneNo: true, email: true, beneficiary: true, joinDate: true } })
  const byId = new Map(members.map((m) => [m.id.toUpperCase(), m]))
  const byName = new Map(members.map((m) => [m.legalName.trim().toLowerCase(), m.id]))
  const seenIds = new Set<string>()
  const seenNames = new Map<string, number>()
  const rows: RowResult[] = []
  const plans: MemberPlan[] = []

  for (const { line, cells } of p.records) {
    const r: RowResult = { line, action: 'error', summary: '', errors: [], warnings: [] }
    const id = get(p, cells, 'memberId').toUpperCase()
    const name = get(p, cells, 'legalName')
    const contact = Object.fromEntries(MEMBER_CONTACT_FIELDS.map((f) => [f, get(p, cells, f)])) as Record<(typeof MEMBER_CONTACT_FIELDS)[number], string>
    if (contact.email && !EMAIL.test(contact.email)) r.errors.push(`"${contact.email}" is not an email address.`)
    for (const f of MEMBER_CONTACT_FIELDS) if (contact[f].length > 200) r.errors.push(`${FIELD_LABELS[f]} is longer than 200 characters.`)

    if (id) {
      r.summary = `${id}${name ? ` · ${name}` : ''}`
      const existing = byId.get(id)
      if (seenIds.has(id)) r.errors.push(`${id} is in the file more than once.`)
      seenIds.add(id)
      if (!existing) r.errors.push(`There is no member ${id}. To add a new member, leave Member ID empty: the app gives the next number.`)
      else {
        if (name && name.trim().toLowerCase() !== existing.legalName.trim().toLowerCase()) {
          r.warnings.push(`The name differs from the app (“${existing.legalName}”). Names are not changed by an import: edit the member in the app.`)
        }
        // A blank cell leaves the field as it is: an import never erases.
        const changes = MEMBER_CONTACT_FIELDS
          .filter((f) => contact[f] && contact[f] !== (existing[f] ?? ''))
          .map((f) => ({ field: FIELD_LABELS[f], from: existing[f], to: contact[f] }))
        if (changes.length && !canUpdate) r.errors.push('You can add members, but your role cannot change existing members’ details.')
        if (!r.errors.length) {
          r.action = changes.length ? 'update' : 'unchanged'
          r.changes = changes
          if (changes.length) plans.push({ line, id: existing.id, update: Object.fromEntries(MEMBER_CONTACT_FIELDS.filter((f) => contact[f] && contact[f] !== (existing[f] ?? '')).map((f) => [f, contact[f]])) })
        }
      }
    } else {
      r.summary = name || '(no name)'
      const joinText = get(p, cells, 'joinDate')
      const joinDate = parseImportDate(joinText)
      if (!name) r.errors.push('A new member needs a legal name.')
      if (!joinText) r.errors.push('A new member needs a join date (Joined).')
      else if (!joinDate) r.errors.push(`"${joinText}" is not a date: use YYYY-MM-DD or M/D/YYYY.`)
      else if (joinDate.getTime() > Date.now()) r.errors.push('The join date is in the future.')
      const key = name.trim().toLowerCase()
      if (name && byName.has(key)) r.warnings.push(`A member named “${name}” already exists (${byName.get(key)}). Check this is a different person.`)
      if (name && seenNames.has(key)) r.warnings.push(`“${name}” is also on line ${seenNames.get(key)}.`)
      if (name) seenNames.set(key, line)
      if (!r.errors.length) {
        r.action = 'add'
        plans.push({ line, id: null, create: { legalName: name, joinDate: joinDate!, nickname: contact.nickname || null, phoneNo: contact.phoneNo || null, email: contact.email || null, beneficiary: contact.beneficiary || null } })
      }
    }
    rows.push(r)
  }
  return { rows, plans }
}

type ContributionPlan = { line: number; memberId: string; paymentDate: Date; amountCents: number; paymentMethod: string | null; receivedBy: string | null; comments: string | null; category: 'dues' | 'voluntary' }

async function planContributions(p: Parsed) {
  const members = new Map((await prisma.member.findMany({ select: { id: true, legalName: true, status: true } })).map((m) => [m.id.toUpperCase(), m]))
  const existing = await prisma.contribution.findMany({ where: { reversedAt: null }, select: { memberId: true, paymentDate: true, amountCents: true, transactionId: true } })
  const recorded = new Map(existing.map((c) => [`${c.memberId}|${c.paymentDate.toISOString().slice(0, 10)}|${c.amountCents}`, c.transactionId]))
  const inFile = new Map<string, number>()
  const today = new Date()
  const rows: RowResult[] = []
  const plans: ContributionPlan[] = []

  for (const { line, cells } of p.records) {
    const r: RowResult = { line, action: 'error', summary: '', errors: [], warnings: [] }
    const id = get(p, cells, 'memberId').toUpperCase()
    const dateText = get(p, cells, 'paymentDate')
    const amountText = get(p, cells, 'amount')
    const kindText = get(p, cells, 'category').toLowerCase()
    const member = members.get(id)
    r.summary = `${id || '(no member)'}${member ? ` · ${member.legalName}` : ''} · ${amountText || '(no amount)'} · ${dateText || '(no date)'}`

    if (!id) r.errors.push('Member ID is empty.')
    else if (!member) r.errors.push(`There is no member ${id}.`)
    else if (member.status !== 'Active') r.warnings.push(`${member.legalName} is ${member.status.toLowerCase()}.`)
    const paymentDate = parseImportDate(dateText)
    if (!dateText) r.errors.push('Paid on is empty.')
    else if (!paymentDate) r.errors.push(`"${dateText}" is not a date: use YYYY-MM-DD or M/D/YYYY.`)
    else if (paymentDate.getTime() > today.getTime()) r.errors.push('The payment date is in the future.')
    let amountCents = 0
    try {
      amountCents = parseDollars(amountText)
      if (amountCents <= 0) r.errors.push('The amount must be more than $0.')
    } catch (err) {
      if (!(err instanceof MoneyError)) throw err
      r.errors.push(amountText ? `"${amountText}" is not an amount in dollars and cents.` : 'Amount is empty.')
    }
    const category = !kindText || kindText === 'dues' ? 'dues' : kindText === 'voluntary' ? 'voluntary' : null
    if (!category) r.errors.push(`Kind must be "dues" or "voluntary", not "${kindText}".`)

    if (!r.errors.length) {
      const key = `${member!.id}|${paymentDate!.toISOString().slice(0, 10)}|${amountCents}`
      if (recorded.has(key)) r.warnings.push(`Looks already recorded: ${recorded.get(key)} has the same member, date and amount.`)
      if (inFile.has(key)) r.warnings.push(`Same member, date and amount as line ${inFile.get(key)}.`)
      inFile.set(key, line)
      r.action = 'add'
      plans.push({
        line, memberId: member!.id, paymentDate: paymentDate!, amountCents, category: category!,
        paymentMethod: get(p, cells, 'paymentMethod') || null, receivedBy: get(p, cells, 'receivedBy') || null, comments: get(p, cells, 'comments') || null,
      })
    }
    rows.push(r)
  }
  return { rows, plans }
}

async function analyse(kind: ImportKind, csv: string, opts: { canUpdateMembers: boolean }) {
  const hash = fileHash(csv)
  const parsed = readFile(kind, csv)
  const planned = kind === 'members' ? await planMembers(parsed, opts.canUpdateMembers) : await planContributions(parsed)
  const prior = await prisma.dataImport.findUnique({ where: { kind_fileHash: { kind, fileHash: hash } }, select: { publicId: true, createdAt: true } })
  const preview = summarize(kind, hash, planned.rows, parsed.ignored, prior ? { publicId: prior.publicId, at: prior.createdAt } : null)
  return { preview, plans: planned.plans }
}

/** What the import would do. Saves nothing. */
export async function previewImport(kind: ImportKind, csv: string, opts: { canUpdateMembers: boolean }): Promise<ImportPreview> {
  return (await analyse(kind, csv, opts)).preview
}

export type ImportResult = { publicId: string; added: number; updated: number; preview: ImportPreview }

/**
 * Imports the file, checked again from scratch: refused while any row has
 * an error, if the file changed since the preview, or if it was imported
 * before. All rows are saved in one transaction, each audited as if typed
 * in, plus one entry for the import itself.
 */
export async function applyImport(kind: ImportKind, csv: string, input: { fileHash: string; fileName?: string; canUpdateMembers: boolean }, ctx: AuditContext): Promise<ImportResult> {
  const { preview, plans } = await analyse(kind, csv, input)
  if (preview.fileHash !== input.fileHash) throw new ImportError('The file is not the one previewed. Preview it again.')
  if (preview.alreadyImported) throw new ImportError(`This file was already imported (${preview.alreadyImported.publicId}).`)
  if (preview.counts.error) throw new ImportError(`${preview.counts.error} ${preview.counts.error === 1 ? 'row has' : 'rows have'} errors. Fix them in the spreadsheet and preview again.`)
  if (!plans.length) throw new ImportError('There is nothing to import: every row is already as in the app.')

  const publicId = nextPublicId('IMP')
  const metadata = { importId: publicId }
  let added = 0
  let updated = 0
  await prisma.$transaction(async (tx) => {
    if (kind === 'members') {
      for (const plan of plans as MemberPlan[]) {
        if (plan.create) {
          const id = await allocateMemberId(tx)
          const created = await tx.member.create({ data: { id, status: 'Active', ...plan.create } })
          await recordAudit(tx, ctx, { action: 'member.create', entityType: 'member', entityId: id, after: created, metadata })
          added++
        } else {
          const before = await tx.member.findUniqueOrThrow({ where: { id: plan.id! } })
          const after = await tx.member.update({ where: { id: plan.id! }, data: plan.update! })
          await recordAudit(tx, ctx, { action: 'member.update', entityType: 'member', entityId: plan.id!, before, after, metadata })
          updated++
        }
      }
    } else {
      for (const plan of plans as ContributionPlan[]) {
        const created = await recordContribution(tx, {
          memberId: plan.memberId, amount: toLegacyDollars(cents(plan.amountCents)), paymentDate: plan.paymentDate,
          paymentMethod: plan.paymentMethod, receivedBy: plan.receivedBy, comments: plan.comments, source: 'Import', category: plan.category,
        })
        await recordAudit(tx, ctx, { action: 'contribution.create', entityType: 'contribution', entityId: created.transactionId, after: created, metadata })
        added++
      }
    }
    await tx.dataImport.create({
      data: { publicId, kind, fileHash: preview.fileHash, fileName: input.fileName?.slice(0, 200) ?? null, rows: preview.rows.length, added, updated, importedBy: ctx.actorLabel ?? 'staff' },
    })
    await recordAudit(tx, ctx, {
      action: 'data.import', entityType: 'data_import', entityId: publicId,
      metadata: { kind, fileName: input.fileName ?? null, rows: preview.rows.length, added, updated, fileHash: preview.fileHash },
    })
  }, { timeout: 120_000, maxWait: 10_000 })
  return { publicId, added, updated, preview }
}
