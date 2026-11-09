// The monthly contributions report as a PDF (US Letter, landscape): a
// header with the club's logo, the month's totals, every member with what
// they paid, the loan repayments received, and a sign-off for the
// Treasurer. Built with pdf-lib's standard fonts, so no font files ship.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { type PDFFont, PDFDocument, type PDFPage, StandardFonts, rgb } from 'pdf-lib'
import { type Cents, formatUSD } from '@/lib/money'
import { type MonthlyReport, joinValues } from './monthlyReport'

const W = 792
const H = 612
const M = 36
const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255)
const GOLD = rgb(0xf5 / 255, 0xb7 / 255, 0x0a / 255)
const INK = rgb(0.11, 0.13, 0.17)
const MUTED = rgb(0.42, 0.45, 0.5)
const LINE = rgb(0.89, 0.9, 0.93)
const TINT = rgb(0.96, 0.97, 0.985)
const HEAD = rgb(0.93, 0.945, 0.97)
const RED = rgb(0.7, 0.14, 0.09)
const ON_DARK = rgb(0.79, 0.83, 0.9)
/** Payment-method bar segments, in order. */
const SEGMENTS = [NAVY, GOLD, rgb(0.36, 0.47, 0.68), rgb(0.62, 0.7, 0.84), rgb(0.85, 0.62, 0.1), rgb(0.75, 0.77, 0.8)]

type Fonts = { regular: PDFFont; bold: PDFFont }
type Column = { title: string; width: number; align?: 'right' }
type Cell = { text: string; bold?: boolean; color?: ReturnType<typeof rgb> }

/** Text the standard fonts can draw: typographic quotes and dashes made plain, anything else outside Latin-1 shown as "?". */
export function pdfText(text: string): string {
  return text
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

/** MM/DD/YYYY, as the club's sheets write dates. */
const us = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`
const money = (c: Cents) => formatUSD(c)

class Layout {
  pages: PDFPage[] = []
  page!: PDFPage
  y = 0
  constructor(private doc: PDFDocument, private f: Fonts, private report: MonthlyReport, private logo: { d: string; color: ReturnType<typeof rgb> }[]) {}

  text(s: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; width?: number; align?: 'right' } = {}) {
    const font = opts.bold ? this.f.bold : this.f.regular
    let t = pdfText(s)
    if (opts.width !== undefined && font.widthOfTextAtSize(t, size) > opts.width) {
      while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > opts.width) t = t.slice(0, -1)
      t = `${t.trimEnd()}...`
    }
    const dx = opts.align === 'right' && opts.width !== undefined ? opts.width - font.widthOfTextAtSize(t, size) : 0
    this.page.drawText(t, { x: x + dx, y, size, font, color: opts.color ?? INK })
  }

  /** A new page: the full header on the first, a slim one after. */
  newPage() {
    this.page = this.doc.addPage([W, H])
    this.pages.push(this.page)
    const first = this.pages.length === 1
    const band = first ? 78 : 34
    this.page.drawRectangle({ x: 0, y: H - band, width: W, height: band, color: NAVY })
    this.page.drawRectangle({ x: 0, y: H - band - 3, width: W, height: 3, color: GOLD })
    if (first) {
      this.drawLogo(M, H - 18, 40)
      this.text('Millionaires Club', M + 84, H - 37, 17, { bold: true, color: rgb(1, 1, 1) })
      this.text('Monthly Contributions Report', M + 84, H - 54, 10, { color: ON_DARK })
      this.text(this.report.label, W - M - 220, H - 40, 20, { bold: true, color: GOLD, width: 220, align: 'right' })
      this.text(`Prepared ${us(this.report.generatedOn)}`, W - M - 220, H - 56, 9, { color: ON_DARK, width: 220, align: 'right' })
    } else {
      this.text(`Millionaires Club  \xB7  Monthly Contributions Report  \xB7  ${this.report.label}`, M, H - 22, 10, { bold: true, color: rgb(1, 1, 1) })
    }
    this.y = H - band - 3 - 22
  }

  drawLogo(x: number, top: number, height: number) {
    // The logo's viewBox is 8 8 496 268.
    const scale = height / 268
    for (const p of this.logo) this.page.drawSvgPath(p.d, { x: x - 8 * scale, y: top + 8 * scale, scale, color: p.color })
  }

  /** Room for `height` more points above the footer, or a new page. */
  need(height: number, onNewPage?: () => void) {
    if (this.y - height < M + 24) {
      this.newPage()
      onNewPage?.()
    }
  }

  heading(title: string, sub?: string) {
    this.need(40)
    this.text(title, M, this.y, 12, { bold: true, color: NAVY })
    if (sub) this.text(sub, M + this.f.bold.widthOfTextAtSize(pdfText(title), 12) + 10, this.y, 9, { color: MUTED })
    this.y -= 14
  }

  tableHeader(cols: Column[]) {
    this.page.drawRectangle({ x: M, y: this.y - 5, width: W - 2 * M, height: 17, color: HEAD })
    let x = M + 6
    for (const c of cols) {
      this.text(c.title, x, this.y, 8, { bold: true, color: NAVY, width: c.width - (c.align ? 16 : 8), align: c.align })
      x += c.width
    }
    this.y -= 17
  }

  table(cols: Column[], rows: Cell[][], total: Cell[]) {
    this.need(17 + 15)
    this.tableHeader(cols)
    rows.forEach((row, i) => {
      this.need(15, () => this.tableHeader(cols))
      if (i % 2 === 1) this.page.drawRectangle({ x: M, y: this.y - 4.5, width: W - 2 * M, height: 15, color: TINT })
      let x = M + 6
      row.forEach((cell, j) => {
        this.text(cell.text, x, this.y, 8.5, { bold: cell.bold, color: cell.color, width: cols[j].width - (cols[j].align ? 16 : 8), align: cols[j].align })
        x += cols[j].width
      })
      this.y -= 15
    })
    this.need(18)
    this.page.drawLine({ start: { x: M, y: this.y + 10 }, end: { x: W - M, y: this.y + 10 }, thickness: 1, color: NAVY })
    let x = M + 6
    total.forEach((cell, j) => {
      this.text(cell.text, x, this.y - 2, 9, { bold: true, color: INK, width: cols[j].width - (cols[j].align ? 16 : 8), align: cols[j].align })
      x += cols[j].width
    })
    this.y -= 20
    this.y -= 12
  }

  /** The month's figures, as four tiles and a bar of payment methods. */
  summary() {
    const t = this.report.totals
    const pct = t.activeMembers ? Math.round((t.paidMembers / t.activeMembers) * 100) : 0
    const tiles: [string, string, string][] = [
      ['Collected', money(t.collectedCents), `Dues ${money(t.duesCents)}  \xB7  Voluntary ${money(t.voluntaryCents)}`],
      ['Members paid', `${t.paidMembers} of ${t.activeMembers}`, `${pct}% of active members`],
      ['No payment this month', String(t.unpaidMembers), t.unpaidMembers === 1 ? 'active member' : 'active members'],
      ['Loan repayments', money(t.repaymentsCents), `${this.report.repayments.length} ${this.report.repayments.length === 1 ? 'payment' : 'payments'} received`],
    ]
    const gap = 12
    const w = (W - 2 * M - gap * 3) / 4
    const h = 58
    tiles.forEach(([label, value, sub], i) => {
      const x = M + i * (w + gap)
      this.page.drawRectangle({ x, y: this.y - h + 10, width: w, height: h, color: TINT, borderColor: LINE, borderWidth: 0.75 })
      this.page.drawRectangle({ x, y: this.y + 8, width: w, height: 2, color: i === 0 ? GOLD : NAVY })
      this.text(label.toUpperCase(), x + 10, this.y - 6, 7.5, { bold: true, color: MUTED, width: w - 20 })
      this.text(value, x + 10, this.y - 26, 17, { bold: true, color: i === 2 && t.unpaidMembers > 0 ? RED : INK, width: w - 20 })
      this.text(sub, x + 10, this.y - 40, 7.5, { color: MUTED, width: w - 20 })
    })
    this.y -= h + 10

    if (t.byMethod.length) {
      this.text('BY PAYMENT METHOD', M, this.y, 7.5, { bold: true, color: MUTED })
      const barX = M + 100
      const barW = W - M - barX
      let x = barX
      t.byMethod.forEach((m, i) => {
        const segment = (m.cents / t.collectedCents) * barW
        this.page.drawRectangle({ x, y: this.y - 1, width: Math.max(segment, 0.5), height: 8, color: SEGMENTS[i % SEGMENTS.length] })
        x += segment
      })
      this.y -= 14
      x = barX
      t.byMethod.forEach((m, i) => {
        const label = `${m.method} ${money(m.cents)} (${m.count})`
        const width = this.f.regular.widthOfTextAtSize(pdfText(label), 8) + 22
        if (x + width > W - M) { x = barX; this.y -= 11 }
        this.page.drawRectangle({ x, y: this.y - 0.5, width: 7, height: 7, color: SEGMENTS[i % SEGMENTS.length] })
        this.text(label, x + 10, this.y, 8, { color: INK })
        x += width
      })
      this.y -= 22
    } else {
      this.text('No contributions were received this month.', M, this.y, 9, { color: MUTED })
      this.y -= 22
    }
  }

  signOff() {
    this.need(60)
    this.y -= 14
    const w = (W - 2 * M - 40) / 2
    for (const [i, who] of ['Prepared by (Treasurer)', 'Reviewed by'].entries()) {
      const x = M + i * (w + 40)
      this.page.drawLine({ start: { x, y: this.y }, end: { x: x + w * 0.68, y: this.y }, thickness: 0.75, color: MUTED })
      this.page.drawLine({ start: { x: x + w * 0.74, y: this.y }, end: { x: x + w, y: this.y }, thickness: 0.75, color: MUTED })
      this.text(who, x, this.y - 11, 8, { color: MUTED })
      this.text('Date', x + w * 0.74, this.y - 11, 8, { color: MUTED })
    }
    this.y -= 24
  }

  footers() {
    const label = `Millionaires Club \xB7 Monthly Contributions Report \xB7 ${this.report.label}`
    this.pages.forEach((page, i) => {
      this.page = page
      page.drawLine({ start: { x: M, y: M + 6 }, end: { x: W - M, y: M + 6 }, thickness: 0.5, color: LINE })
      this.text(label, M, M - 6, 7.5, { color: MUTED })
      this.text(`Page ${i + 1} of ${this.pages.length}`, W - M - 100, M - 6, 7.5, { color: MUTED, width: 100, align: 'right' })
    })
  }
}

const MEMBER_COLUMNS: Column[] = [
  { title: 'Member ID', width: 62 }, { title: 'Name', width: 140 }, { title: 'Nickname', width: 92 }, { title: 'Joined', width: 58 },
  { title: 'Paid on', width: 78 }, { title: 'Amount', width: 62, align: 'right' }, { title: 'Method', width: 70 },
  { title: 'Received by', width: 72 }, { title: 'Covers / note', width: 86 },
]
const REPAYMENT_COLUMNS: Column[] = [
  { title: 'Loan ID', width: 92 }, { title: 'Borrower', width: 170 }, { title: 'Member ID', width: 72 }, { title: 'Paid on', width: 72 },
  { title: 'Amount', width: 72, align: 'right' }, { title: 'Method', width: 110 }, { title: 'Received by', width: 132 },
]

/** The logo's shapes, from the file the app serves; none if it can't be read. */
export async function loadLogo(file = path.join(process.cwd(), 'public/brand/mc-logo-on-dark.svg')) {
  try {
    const svg = await readFile(file, 'utf8')
    return [...svg.matchAll(/<path fill="#([0-9A-Fa-f]{6})" d="([^"]+)"/g)].map(([, hex, d]) => ({
      d, color: rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255),
    }))
  } catch {
    return []
  }
}

export async function monthlyReportPdf(report: MonthlyReport, logo?: Awaited<ReturnType<typeof loadLogo>>): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Millionaires Club - Monthly Contributions - ${report.label}`)
  doc.setAuthor('Millionaires Club')
  doc.setCreationDate(new Date(`${report.generatedOn}T12:00:00Z`))
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  const l = new Layout(doc, fonts, report, logo ?? await loadLogo())
  l.newPage()
  l.summary()

  const t = report.totals
  l.heading('Members', `${report.members.length} listed \xB7 ${t.paidMembers} paid \xB7 ${t.unpaidMembers} no payment`)
  const rows: Cell[][] = report.members.map((m) => {
    const paid = m.payments.length > 0
    return [
      { text: m.memberId, color: MUTED },
      { text: m.name, bold: true },
      { text: m.nickname ?? '' },
      { text: us(m.joined), color: MUTED },
      { text: paid ? m.payments.map((p) => us(p.date).slice(0, 5)).join(', ') : 'No payment', color: paid ? INK : RED },
      { text: paid ? money(m.paidCents) : '-', bold: paid, color: paid ? INK : MUTED },
      { text: joinValues(m.payments.map((p) => p.method)) },
      { text: joinValues(m.payments.map((p) => p.receivedBy)) },
      { text: joinValues([...m.payments.map((p) => p.covers), ...m.payments.map((p) => p.note)]), color: MUTED },
    ]
  })
  l.table(MEMBER_COLUMNS, rows, [
    { text: 'Total' }, { text: `${t.payments} ${t.payments === 1 ? 'payment' : 'payments'}` }, { text: '' }, { text: '' }, { text: '' },
    { text: money(t.collectedCents) }, { text: '' }, { text: '' }, { text: '' },
  ])

  l.heading('Loan repayments received')
  if (report.repayments.length) {
    l.table(REPAYMENT_COLUMNS, report.repayments.map((r) => [
      { text: r.loanId, color: MUTED }, { text: r.borrower, bold: true }, { text: r.memberId, color: MUTED }, { text: us(r.date) },
      { text: money(r.amountCents), bold: true }, { text: r.method ?? '' }, { text: r.receivedBy ?? '' },
    ]), [{ text: 'Total' }, { text: '' }, { text: '' }, { text: '' }, { text: money(t.repaymentsCents) }, { text: '' }, { text: '' }])
  } else {
    l.text(`No loan repayments were received in ${report.label}.`, M, l.y, 9, { color: MUTED })
    l.y -= 20
  }

  l.signOff()
  l.footers()
  return doc.save()
}
