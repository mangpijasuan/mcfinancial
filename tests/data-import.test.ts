import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseFixtures, createMember } from './helpers/factories'
import { TEST_IDS, signInAs, staffEmail } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { callRoute } from './helpers/routes'
import { systemAuditContext } from '@/modules/audit'
import { CsvError, cellText, headerKey, parseCsv } from '@/modules/data/csv'
import { ImportError, MAX_IMPORT_ROWS, applyImport, fileHash, parseImportDate, previewImport } from '@/modules/data/import'

const A = TEST_IDS.member
const B = TEST_IDS.otherMember
const ctx = systemAuditContext('treasurer@example.test')
// Audit entries are never reset, and ids only grow: count those after the test began.
let lastId: bigint
const audits = (action: string) => prisma.auditLog.count({ where: { action, id: { gt: lastId } } })

const csv = (...lines: string[]) => lines.join('\r\n') + '\r\n'
const MEMBERS = (...rows: string[]) => csv('Member ID,Legal name,Joined,Nickname,Phone,Email,Beneficiary', ...rows)
const CONTRIBUTIONS = (...rows: string[]) => csv('Member ID,Paid on,Amount,Method,Kind,Received by,Note', ...rows)
const both = { canUpdateMembers: true }
const doImport = async (kind: 'members' | 'contributions', file: string, opts = both) =>
  applyImport(kind, file, { fileHash: fileHash(file), fileName: `${kind}.csv`, ...opts }, ctx)

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  lastId = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0)
})

describe('reading CSV', () => {
  it('reads what Excel, Numbers and Google Sheets save', () => {
    expect(parseCsv('﻿a,b\r\n1,"two, three"\n"say ""hi""","line\nbreak"\r\n\r\n,,\nlast,')).toEqual([
      ['a', 'b'], ['1', 'two, three'], ['say "hi"', 'line\nbreak'], ['last', ''],
    ])
    expect(parseCsv('x,y')).toEqual([['x', 'y']])
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('a,b\r')).toEqual([['a', 'b']])
    expect(() => parseCsv('a,"open')).toThrow(CsvError)
  })

  it('reads cells as typed, undoing the export’s formula guard', () => {
    expect(cellText("  '+1 555  ")).toBe('+1 555')
    expect(cellText("'=SUM(A1)")).toBe('=SUM(A1)')
    expect(cellText("O'Brien")).toBe("O'Brien")
    expect(cellText(undefined)).toBe('')
    expect(headerKey('Member ID')).toBe('memberid')
    expect(headerKey('member_id')).toBe('memberid')
  })

  it('reads dates as YYYY-MM-DD or M/D/YYYY, and only real ones', () => {
    expect(parseImportDate('2026-02-03')!.toISOString()).toBe('2026-02-03T00:00:00.000Z')
    expect(parseImportDate('2/3/2026')!.toISOString()).toBe('2026-02-03T00:00:00.000Z')
    expect(parseImportDate('12/31/2025')!.toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(parseImportDate('2026-02-30')).toBeNull()
    expect(parseImportDate('13/01/2026')).toBeNull()
    expect(parseImportDate('Feb 3 2026')).toBeNull()
  })

  it('gives the same hash for the same file saved on Windows or a Mac', () => {
    expect(fileHash('a,b\r\n1,2\r\n')).toBe(fileHash('﻿a,b\n1,2\n'))
    expect(fileHash('a,b\n1,2\n')).not.toBe(fileHash('a,b\n1,3\n'))
  })
})

describe('the file as a whole', () => {
  it('refuses a file that cannot be imported, saying why', async () => {
    await expect(previewImport('members', '', both)).rejects.toThrow('The file is empty.')
    await expect(previewImport('members', 'a,"b', both)).rejects.toThrow(/missing closing quote/)
    await expect(previewImport('members', 'x'.repeat(1024 * 1024 + 1), both)).rejects.toThrow(/larger than 1 MB/)
    await expect(previewImport('members', csv('Member ID,Phone'), both)).rejects.toThrow('The file needs a column named "Legal name" in its first row.')
    await expect(previewImport('contributions', csv('Member ID,Note'), both)).rejects.toThrow('The file needs columns named "Paid on" and "Amount" in its first row.')
    const big = csv('Member ID,Paid on,Amount', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => `${A},2026-01-05,1`))
    await expect(previewImport('contributions', big, both)).rejects.toThrow(`The file has ${MAX_IMPORT_ROWS + 1} rows; the most at once is ${MAX_IMPORT_ROWS}.`)
  })

  it('names the columns it ignores, and takes the first of two with the same meaning', async () => {
    const p = await previewImport('members', csv('ID,Name,Contributed in total,,Name', `${A},Test Member ${A},100,,Other`), both)
    expect(p.ignoredColumns).toEqual(['Contributed in total', 'Name'])
    expect(p.rows[0].warnings).toEqual([])
  })
})

describe('importing members', () => {
  it('previews additions and contact changes without saving anything', async () => {
    const file = MEMBERS(
      ',Jane Example,2026-10-01,Janie,555-0100,jane@example.test,John',
      `${A},Test Member ${A},,,555-0199,,`,
      `${B},Test Member ${B},,,,,`,
    )
    const p = await previewImport('members', file, both)
    expect(p.counts).toEqual({ add: 1, update: 1, unchanged: 1, error: 0, warnings: 0 })
    expect(p.rows[0]).toMatchObject({ line: 2, action: 'add', summary: 'Jane Example' })
    expect(p.rows[1]).toMatchObject({ action: 'update', changes: [{ field: 'Phone', from: null, to: '555-0199' }] })
    expect(p.rows[2]).toMatchObject({ action: 'unchanged', changes: [] })
    expect(p.alreadyImported).toBeNull()
    expect(await prisma.member.count()).toBe(2)
    expect(await prisma.dataImport.count()).toBe(0)
  })

  it('imports them all at once, numbered and audited like members added by hand', async () => {
    const file = MEMBERS(
      ',Jane Example,2026-10-01,Janie,555-0100,jane@example.test,John',
      ',Sam Example,1/15/2026,,,,',
      `${A},,,,555-0199,new@example.test,`,
    )
    const result = await doImport('members', file)
    expect(result).toMatchObject({ added: 2, updated: 1 })
    expect(result.publicId).toMatch(/^IMP-/)
    const jane = await prisma.member.findFirstOrThrow({ where: { legalName: 'Jane Example' } })
    expect(jane).toMatchObject({ status: 'Active', nickname: 'Janie', phoneNo: '555-0100', email: 'jane@example.test', beneficiary: 'John' })
    expect(jane.id).toMatch(/^MC-\d+$/)
    expect(jane.joinDate.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(await prisma.member.findUniqueOrThrow({ where: { id: A } })).toMatchObject({ phoneNo: '555-0199', email: 'new@example.test', legalName: `Test Member ${A}` })
    expect(await audits('member.create')).toBe(2)
    expect(await audits('member.update')).toBe(1)
    expect(await audits('data.import')).toBe(1)
    expect(await prisma.dataImport.findFirstOrThrow()).toMatchObject({ kind: 'members', rows: 3, added: 2, updated: 1, fileName: 'members.csv', importedBy: 'treasurer@example.test' })
  })

  it('never imports the same file twice', async () => {
    const file = MEMBERS(',Jane Example,2026-10-01,,,,')
    await doImport('members', file)
    const again = await previewImport('members', file, both)
    expect(again.alreadyImported?.publicId).toMatch(/^IMP-/)
    await expect(doImport('members', file)).rejects.toThrow(/already imported \(IMP-/)
    expect(await prisma.member.count({ where: { legalName: 'Jane Example' } })).toBe(1)
  })

  it('refuses rows it cannot import, and then imports nothing', async () => {
    const file = MEMBERS(
      ',Jane Example,2026-10-01,,,,',
      'MC-99999,Nobody,,,,,',
      ',,,Nick,,,',
      ',No Date,,,,,',
      ',Bad Date,31/31/2026,,,,',
      ',Future,2999-01-01,,,,',
      `${A},,,,,not-an-email,`,
      `${A},,,,,,`,
      `,Long,2026-01-01,${'x'.repeat(201)},,,`,
    )
    const p = await previewImport('members', file, both)
    const errors = p.rows.map((r) => r.errors)
    expect(p.counts.error).toBe(8)
    expect(errors[1]).toEqual(['There is no member MC-99999. To add a new member, leave Member ID empty: the app gives the next number.'])
    expect(errors[2]).toEqual(['A new member needs a legal name.', 'A new member needs a join date (Joined).'])
    expect(errors[3]).toEqual(['A new member needs a join date (Joined).'])
    expect(errors[4]).toEqual(['"31/31/2026" is not a date: use YYYY-MM-DD or M/D/YYYY.'])
    expect(errors[5]).toEqual(['The join date is in the future.'])
    expect(errors[6]).toEqual(['"not-an-email" is not an email address.'])
    expect(errors[7]).toEqual([`${A} is in the file more than once.`])
    expect(errors[8]).toEqual(['Nickname is longer than 200 characters.'])
    expect(p.rows[2].summary).toBe('(no name)')
    await expect(doImport('members', file)).rejects.toThrow('8 rows have errors. Fix them in the spreadsheet and preview again.')
    await expect(doImport('members', MEMBERS('MC-99999,Nobody,,,,,'))).rejects.toThrow('1 row has errors.')
    expect(await prisma.member.count()).toBe(2)
  })

  it('warns about names it already knows, and never changes a name', async () => {
    const p = await previewImport('members', MEMBERS(
      `,Test Member ${A},2026-01-01,,,,`,
      ',Twin,2026-01-01,,,,',
      ',twin,2026-01-01,,,,',
      `${B},Someone Else,,,,,`,
    ), both)
    expect(p.rows[0].warnings).toEqual([`A member named “Test Member ${A}” already exists (${A}). Check this is a different person.`])
    expect(p.rows[2].warnings).toEqual(['“twin” is also on line 3.'])
    expect(p.rows[3]).toMatchObject({ action: 'unchanged', warnings: [`The name differs from the app (“Test Member ${B}”). Names are not changed by an import: edit the member in the app.`] })
    expect(p.counts.warnings).toBe(3)
  })

  it('lets a role that can add members but not edit them add only', async () => {
    const p = await previewImport('members', MEMBERS(`${A},,,,555-0000,,`, `${B},,,,,,`), { canUpdateMembers: false })
    expect(p.rows[0].errors).toEqual(['You can add members, but your role cannot change existing members’ details.'])
    expect(p.rows[1].action).toBe('unchanged')
  })

  it('has nothing to do when every row already matches, or the file changed after the preview', async () => {
    await expect(doImport('members', MEMBERS(`${A},,,,,,`))).rejects.toThrow('There is nothing to import')
    const file = MEMBERS(',Jane Example,2026-10-01,,,,')
    await expect(applyImport('members', file, { fileHash: fileHash(file + 'x'), canUpdateMembers: true }, ctx)).rejects.toThrow('The file is not the one previewed. Preview it again.')
  })

  it('records who imported it when the audit context has no name', async () => {
    const file = MEMBERS(',Jane Example,2026-10-01,,,,')
    await applyImport('members', file, { fileHash: fileHash(file), canUpdateMembers: true }, { ...ctx, actorLabel: null })
    expect(await prisma.dataImport.findFirstOrThrow()).toMatchObject({ importedBy: 'staff', fileName: null })
  })
})

describe('importing contributions', () => {
  it('records each one like a payment typed in: receipt, dues, audit', async () => {
    const file = CONTRIBUTIONS(
      `${A},2026-01-05,20,Zelle,dues,Treasurer,January`,
      `${B},2/5/2026,"$1,000.50",,voluntary,,`,
    )
    const p = await previewImport('contributions', file, both)
    expect(p.counts).toEqual({ add: 2, update: 0, unchanged: 0, error: 0, warnings: 0 })
    expect(p.rows[0].summary).toBe(`${A} · Test Member ${A} · 20 · 2026-01-05`)
    const result = await doImport('contributions', file)
    expect(result).toMatchObject({ added: 2, updated: 0 })
    const rows = await prisma.contribution.findMany({ orderBy: { paymentDate: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ memberId: A, amount: 20, paymentMethod: 'Zelle', receivedBy: 'Treasurer', comments: 'January', source: 'Import', category: 'dues' })
    expect(rows[0].receiptNumber).toMatch(/^RC-/)
    expect(rows[1]).toMatchObject({ memberId: B, amount: 1000.5, category: 'voluntary', paymentMethod: null })
    expect(await audits('contribution.create')).toBe(2)
  })

  it('refuses rows it cannot record', async () => {
    await prisma.member.update({ where: { id: B }, data: { status: 'Inactive' } })
    const p = await previewImport('contributions', CONTRIBUTIONS(
      ',2026-01-05,20,,,,',
      'MC-99999,2026-01-05,20,,,,',
      `${A},,20,,,,`,
      `${A},2026-13-01,20,,,,`,
      `${A},2999-01-01,20,,,,`,
      `${A},2026-01-05,,,,,`,
      `${A},2026-01-05,twenty,,,,`,
      `${A},2026-01-05,0,,,,`,
      `${A},2026-01-05,1.234,,,,`,
      `${A},2026-01-05,20,,gift,,`,
      `${B},2026-01-05,20,,,,`,
    ), both)
    const e = p.rows.map((r) => r.errors)
    expect(e[0]).toEqual(['Member ID is empty.'])
    expect(e[1]).toEqual(['There is no member MC-99999.'])
    expect(e[2]).toEqual(['Paid on is empty.'])
    expect(e[3]).toEqual(['"2026-13-01" is not a date: use YYYY-MM-DD or M/D/YYYY.'])
    expect(e[4]).toEqual(['The payment date is in the future.'])
    expect(e[5]).toEqual(['Amount is empty.'])
    expect(e[6]).toEqual(['"twenty" is not an amount in dollars and cents.'])
    expect(e[7]).toEqual(['The amount must be more than $0.'])
    expect(e[8]).toEqual(['"1.234" is not an amount in dollars and cents.'])
    expect(e[9]).toEqual(['Kind must be "dues" or "voluntary", not "gift".'])
    expect(p.rows[10]).toMatchObject({ action: 'add', warnings: [`Test Member ${B} is inactive.`] })
    expect(p.rows[0].summary).toBe('(no member) · 20 · 2026-01-05')
    expect(p.rows[5].summary).toBe(`${A} · Test Member ${A} · (no amount) · 2026-01-05`)
    expect(p.rows[2].summary).toContain('(no date)')
  })

  it('warns about payments that look already recorded, or twice in the file', async () => {
    await doImport('contributions', CONTRIBUTIONS(`${A},2026-01-05,20,,,,`))
    const p = await previewImport('contributions', CONTRIBUTIONS(`${A},2026-01-05,20.00,,,,first`, `${A},1/5/2026,20,,,,second`), both)
    expect(p.rows[0].warnings[0]).toMatch(/^Looks already recorded: CON-.+ has the same member, date and amount\.$/)
    expect(p.rows[1].warnings).toHaveLength(2)
    expect(p.rows[1].warnings[1]).toBe('Same member, date and amount as line 2.')
  })

  it('saves nothing if one payment fails while recording', async () => {
    const file = CONTRIBUTIONS(`${A},2026-01-05,20,,,,`, `${B},2026-01-06,30,,,,`)
    const real = prisma.$transaction.bind(prisma)
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: any, opts: any) => real(async (tx: any) => {
      await fn(tx)
      throw new Error('ledger refused')
    }, opts)) as any)
    await expect(doImport('contributions', file)).rejects.toThrow('ledger refused')
    vi.restoreAllMocks()
    expect(await prisma.contribution.count()).toBe(0)
    expect(await prisma.dataImport.count()).toBe(0)
  })

  it('passes on an unexpected error while reading amounts', async () => {
    const money = await import('@/lib/money')
    vi.spyOn(money, 'parseDollars').mockImplementationOnce(() => { throw new TypeError('boom') })
    await expect(previewImport('contributions', CONTRIBUTIONS(`${A},2026-01-05,20,,,,`), both)).rejects.toThrow('boom')
    vi.restoreAllMocks()
  })
})

describe('import routes', () => {
  const MEMBER_FILE = MEMBERS(',Jane Example,2026-10-01,,,,')
  const PAY_FILE = CONTRIBUTIONS(`${A},2026-01-05,20,,,,`)

  it('previews and imports members for staff who can add members', async () => {
    signInAs('administrator')
    const preview = await callRoute('data/import/members/preview', 'POST', { body: { csv: MEMBER_FILE } })
    expect(preview.status).toBe(200)
    expect(preview.json.counts.add).toBe(1)
    expect((await callRoute('data/import/members', 'POST', { body: { csv: MEMBER_FILE } })).json.error).toBe('Preview the file before importing it.')
    const done = await callRoute('data/import/members', 'POST', { body: { csv: MEMBER_FILE, fileHash: preview.json.fileHash, fileName: 'jane.csv' } })
    expect(done.status).toBe(201)
    expect(done.json.added).toBe(1)
    expect((await prisma.dataImport.findFirstOrThrow()).importedBy).toBe(staffEmail('administrator'))
    const twice = await callRoute('data/import/members', 'POST', { body: { csv: MEMBER_FILE, fileHash: preview.json.fileHash } })
    expect(twice.status).toBe(409)
    expect(twice.json.error).toMatch(/already imported/)
  })

  it('records contributions for staff who can record them, and no one else', async () => {
    signInAs('finance')
    const preview = await callRoute('data/import/contributions/preview', 'POST', { body: { csv: PAY_FILE } })
    expect((await callRoute('data/import/contributions', 'POST', { body: { csv: PAY_FILE, fileHash: preview.json.fileHash } })).status).toBe(201)
    // Finance can change contact details but not add members.
    expect((await callRoute('data/import/members/preview', 'POST', { body: { csv: MEMBER_FILE } })).status).toBe(403)
    for (const actor of ['auditor', 'board', 'member'] as const) {
      signInAs(actor)
      expect((await callRoute('data/import/contributions/preview', 'POST', { body: { csv: PAY_FILE } })).status, actor).toBe(403)
    }
  })

  it('says what is wrong with a request or a file', async () => {
    signInAs('treasurer')
    expect((await callRoute('data/import/contributions/preview', 'POST', { body: {} })).json.error).toBe('Choose a CSV file to import.')
    expect((await callRoute('data/import/contributions', 'POST', { body: { csv: 3 } })).status).toBe(400)
    const empty = await callRoute('data/import/contributions/preview', 'POST', { body: { csv: '' } })
    expect(empty).toMatchObject({ status: 400, json: { error: 'The file is empty.' } })
    const bad = await callRoute('data/import/contributions', 'POST', { body: { csv: CONTRIBUTIONS(',2026-01-05,20,,,,'), fileHash: 'x' } })
    expect(bad.status).toBe(409)
  })

  it('refuses the second of two imports of one file at the same moment, and passes on other failures', async () => {
    signInAs('treasurer')
    const hash = fileHash(PAY_FILE)
    vi.spyOn(prisma.dataImport, 'findUnique').mockResolvedValue(null) // both checks see no earlier import
    expect((await callRoute('data/import/contributions', 'POST', { body: { csv: PAY_FILE, fileHash: hash } })).status).toBe(201)
    const second = await callRoute('data/import/contributions', 'POST', { body: { csv: PAY_FILE, fileHash: hash } })
    expect(second).toMatchObject({ status: 409, json: { error: 'This file was just imported.' } })
    expect(await prisma.contribution.count()).toBe(1)

    signInAs('administrator')
    vi.spyOn(prisma.member, 'findMany').mockRejectedValueOnce(new Error('database down'))
    await expect(callRoute('data/import/members/preview', 'POST', { body: { csv: MEMBER_FILE } })).rejects.toThrow('database down')
    vi.spyOn(prisma.member, 'findMany').mockRejectedValueOnce(new Error('database down'))
    await expect(callRoute('data/import/members', 'POST', { body: { csv: MEMBER_FILE, fileHash: 'x' } })).rejects.toThrow('database down')
    vi.restoreAllMocks()
  })

  it('rejects an import error as an ImportError', () => {
    expect(new ImportError('x')).toBeInstanceOf(Error)
  })
})

describe('a member with the same id written differently', () => {
  it('matches member IDs whatever their case', async () => {
    await createMember('MC-10001')
    const p = await previewImport('contributions', CONTRIBUTIONS('mc-10001,2026-01-05,20,,,,'), both)
    expect(p.rows[0]).toMatchObject({ action: 'add', errors: [] })
  })
})
