import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/**
 * Dollars for display: whole amounts without cents ($1,000), anything else
 * to the cent ($41.67), so a figure on screen never differs from what is
 * charged or owed by a rounding.
 */
export function fmt$(n: number) {
  const whole = Math.abs(Math.round(n * 100)) % 100 === 0
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n)
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return '—'
  const date = new Date(d)
  // A date without a time (stored as midnight UTC) is shown as that calendar
  // date; in US time zones it would otherwise show as the day before.
  const dateOnly = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) })
}

export function fmtDateInput(d: Date | string | null | undefined) {
  if (!d) return ''
  return new Date(d).toISOString().split('T')[0]
}

export function monthYearOptions() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const year = new Date().getFullYear()
  return months.map(m => `${m}-${year}`)
}

/** A short dollar amount for chart axes: $500, $1k, $1.5k, $12k. */
export function fmtCompact$(n: number) {
  if (Math.abs(n) < 1000) return `$${Math.round(n)}`
  const k = n / 1000
  return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`
}

/**
 * A stored loan-eligibility code ("YES", "NO - Active Loan/Cosign") in
 * plain words. `short` for a badge, the full reason for the member.
 */
export function eligibilityText(code: string | null | undefined, short = false): string {
  if (code === 'YES') return 'Eligible'
  const reasons: Record<string, [string, string]> = {
    'NO - Active Loan/Cosign': ['Has a loan or co-sign', 'Not now: you have a loan, or co-sign one, still being repaid.'],
    'NO - Inactive': ['Inactive', 'Not now: your membership is inactive.'],
    'NO - Loan written off': ['Past loan written off', 'Not now: a past loan was written off. Please speak to the Treasurer.'],
  }
  const known = code ? reasons[code] : undefined
  if (known) return short ? known[0] : known[1]
  const rest = (code ?? '').replace(/^NO\s*-\s*/i, '').trim()
  return short ? (rest || 'Not eligible') : `Not eligible now${rest ? `: ${rest}` : ''}.`
}
