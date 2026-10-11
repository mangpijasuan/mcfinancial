// Reading CSV files saved by Excel, Numbers or Google Sheets (RFC 4180):
// quoted fields, commas and line breaks inside quotes, doubled quotes, a
// byte-order mark, and Windows or Unix line endings.

export class CsvError extends Error {}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 2; continue }
      if (ch === '"') { quoted = false; i++; continue }
      cell += ch
      i++
      continue
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue }
    if (ch === '\r' || ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      continue
    }
    cell += ch
    i++
  }
  if (quoted) throw new CsvError('The file ends inside a quoted cell: check for a missing closing quote (").')
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  // Blank lines (a row of empty cells) are not records.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * A cell as typed: trimmed, and without the apostrophe the export puts in
 * front of text that looks like a formula ("'+1 555" is "+1 555").
 */
export function cellText(value: string | undefined): string {
  const v = (value ?? '').trim()
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v
}

/** Header names compared loosely: "Member ID", "member_id" and "MemberID" match. */
export const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
