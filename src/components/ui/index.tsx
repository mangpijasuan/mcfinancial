'use client'
import { cn, eligibilityText } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/* ── Badge ──────────────────────────────────────────────── */
type BadgeVariant = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'purple' | 'teal'
const badgeClasses: Record<BadgeVariant, string> = {
  green:  'bg-green-100  text-green-800',
  red:    'bg-red-100    text-red-800',
  amber:  'bg-amber-100  text-amber-800',
  blue:   'bg-blue-100   text-blue-800',
  gray:   'bg-gray-100   text-gray-600',
  purple: 'bg-purple-100 text-purple-800',
  teal:   'bg-teal-100   text-teal-800',
}
export function Badge({ children, variant = 'gray' }: { children: React.ReactNode; variant?: BadgeVariant }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', badgeClasses[variant])}>
      {children}
    </span>
  )
}

/* ── Status helpers ─────────────────────────────────────── */
export function StatusBadge({ status }: { status: string }) {
  const v: BadgeVariant = status === 'Active' ? 'green' : 'gray'
  return <Badge variant={v}>{status}</Badge>
}
export function EligibleBadge({ eligible }: { eligible: string }) {
  const v: BadgeVariant = eligible === 'YES' ? 'green' : 'red'
  return <Badge variant={v}>{eligible === 'YES' ? '✓ Eligible' : eligibilityText(eligible, true)}</Badge>
}
export function RiskBadge({ risk }: { risk: string }) {
  return <Badge variant={risk === 'HIGH' ? 'red' : 'green'}>{risk}</Badge>
}
export function PaidBadge({ paid }: { paid: string }) {
  return <Badge variant={paid === 'PAID' ? 'green' : 'red'}>{paid === 'PAID' ? '✓ Paid' : 'Not paid'}</Badge>
}
// Colour carries meaning: red needs action, amber is waiting on someone,
// blue is in progress as expected, green is done, grey is closed.
export function LoanStatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) return <Badge variant="red">⚠ Overdue</Badge>
  if (status === 'Active') return <Badge variant="blue">Active</Badge>
  if (status === 'Paid Off') return <Badge variant="green">Paid Off</Badge>
  if (status === 'Charged Off') return <Badge variant="red">Written off</Badge>
  return <Badge variant="gray">{status}</Badge>
}

/** A status word from the API ("completed", "pending_review") as shown on screen: "Completed", "Pending review". */
export function statusLabel(status: string): string {
  const words = status.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/** "1 loan", "3 loans". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/* ── Button ─────────────────────────────────────────────── */
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
const btnClasses: Record<BtnVariant, string> = {
  primary:   'bg-[#1B2A4A] text-white hover:bg-[#243660]',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  danger:    'bg-red-600 text-white hover:bg-red-700',
  ghost:     'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
}
export function Button({
  children, onClick, variant = 'primary', size = 'md',
  disabled, type = 'button', className,
}: {
  children: React.ReactNode; onClick?: () => void; variant?: BtnVariant
  size?: 'sm' | 'md'; disabled?: boolean; type?: 'button' | 'submit'; className?: string
}) {
  return (
    <button
      type={type} onClick={onClick} disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        btnClasses[variant], className
      )}
    >
      {children}
    </button>
  )
}

/* ── Card ───────────────────────────────────────────────── */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl border border-gray-200 shadow-xs', className)}>{children}</div>
}

/* ── Input ──────────────────────────────────────────────── */
export function Input({ label, error, className, id, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  // Tie the label to its input, so screen readers announce it and a click on it focuses the field.
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>}
      <input
        id={inputId}
        className={cn('px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white', error && 'border-red-400', className)}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

/* ── Select ─────────────────────────────────────────────── */
export function Select({ label, error, children, className, id, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={selectId} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>}
      <select
        id={selectId}
        className={cn('px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white', error && 'border-red-400', className)}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

/* ── Textarea ───────────────────────────────────────────── */
export function Textarea({ label, error, className, id, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={textareaId} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>}
      <textarea
        id={textareaId}
        rows={3}
        className={cn('px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white resize-none', error && 'border-red-400', className)}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

/* ── Scroll area ────────────────────────────────────────── */
/**
 * A box that scrolls sideways (a wide table on a phone). It can take focus,
 * so keyboard users can scroll it too, and is named for screen readers.
 */
export function ScrollArea({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn('overflow-x-auto focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500', className)}>
      {children}
    </div>
  )
}

/* ── Table ──────────────────────────────────────────────── */
/**
 * A column heading, optionally with classes (e.g. `hidden xl:table-cell` for
 * a secondary column the matching cells also hide), so the columns that
 * matter (status, balance, actions) stay in view on narrower screens.
 */
export type TableHeader = string | { label: string; className?: string }
export function Table({ headers, children, loading, label = 'Table' }: { headers: TableHeader[]; children: React.ReactNode; loading?: boolean; label?: string }) {
  return (
    <ScrollArea label={label} className="scroll-shadow-x">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/80">
            {headers.map(h => {
              const { label, className } = typeof h === 'string' ? { label: h, className: undefined } : h
              return <th key={label} scope="col" className={cn('text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap', className)}>{label}</th>
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <tr><td colSpan={headers.length} className="py-16 text-center text-gray-400 text-sm">Loading…</td></tr>
          ) : children}
        </tbody>
      </table>
    </ScrollArea>
  )
}

/* ── Modal ──────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // Read through a ref so a new onClose each render does not re-run the
  // effect below (which would move focus back to the first field).
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // While open: the page behind does not scroll, focus moves into the dialog
  // and stays there (Tab wraps), Escape closes it, and focus returns to
  // whatever opened it.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    document.body.style.overflow = 'hidden'
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])
    // The first field if there is one, else the first control (the close button).
    const fields = focusable()
    ;(fields.find((el) => el.matches('input, select, textarea')) ?? fields[0])?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { onCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn('relative bg-white rounded-2xl shadow-2xl w-full mx-auto max-h-[90vh] flex flex-col', width)}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h3 id={titleId} className="text-base font-semibold text-gray-900">{title}</h3>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors rounded-lg p-1 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/* ── Stat card ──────────────────────────────────────────── */
const statColors: Record<string, string> = {
  navy:   'bg-[#1B2A4A]',
  teal:   'bg-teal-600',
  amber:  'bg-amber-500',
  green:  'bg-green-600',
  red:    'bg-red-600',
  blue:   'bg-blue-600',
  purple: 'bg-purple-600',
}
/**
 * A headline figure. `tone` (preferred) keeps colour meaningful: "plain"
 * for an ordinary figure, "alert" for one that needs attention now. The
 * older `color` fills remain for pages not yet moved over.
 */
export function StatCard({ label, value, sub, color = 'navy', icon, tone }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode; tone?: 'plain' | 'alert'
}) {
  if (tone) {
    const alert = tone === 'alert'
    return (
      <div className={cn('rounded-xl border p-5 shadow-xs', alert ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white')}>
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm font-medium', alert ? 'text-red-800' : 'text-gray-600')}>{label}</p>
          {icon && <span aria-hidden className={cn('text-lg', alert ? 'text-red-500' : 'text-gray-400')}>{icon}</span>}
        </div>
        <p className={cn('mt-2 text-3xl font-bold tracking-tight tabular-nums', alert ? 'text-red-700' : 'text-gray-900')}>{value}</p>
        {sub && <p className={cn('mt-1 text-xs', alert ? 'text-red-700' : 'text-gray-500')}>{sub}</p>}
      </div>
    )
  }
  return (
    <div className={cn('rounded-xl p-5 text-white', statColors[color] || statColors.navy)}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium opacity-80">{label}</p>
        {icon && <span className="opacity-60 text-lg">{icon}</span>}
      </div>
      <p className="text-3xl font-bold mt-2 tracking-tight">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  )
}

/* ── Page header ────────────────────────────────────────── */
export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {sub && <p className="text-sm text-gray-500 mt-0.5">{sub}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{action}</div>}
    </div>
  )
}

/* ── Empty state ────────────────────────────────────────── */
export function EmptyState({ message = 'No records found.' }: { message?: string }) {
  return <tr><td colSpan={20} className="py-16 text-center text-gray-400 text-sm">{message}</td></tr>
}

/* ── Spinner ────────────────────────────────────────────── */
export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  )
}

/* ── Filter bar ─────────────────────────────────────────── */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 mb-4">{children}</div>
}

/* ── Search input ───────────────────────────────────────── */
export function SearchInput({ value, onChange, placeholder = 'Search…', label }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const [draft, setDraft] = useState(value)
  const first = useRef(true)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => onChange(draft), 200)
    return () => clearTimeout(t)
  }, [draft, onChange])

  return (
    <input
      type="search" value={draft} onChange={e => setDraft(e.target.value)}
      placeholder={placeholder}
      // A placeholder is not a label: screen readers need a name that stays.
      aria-label={label ?? placeholder.replace(/…$/, '')}
      autoComplete="off"
      spellCheck={false}
      className="min-h-10 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white w-full sm:w-56"
    />
  )
}
