// The member portal's building blocks: one look for every page (cards,
// headings, figures, statuses, lists), in the club's navy and gold.
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The surface every portal card shares. */
export const surface = 'rounded-2xl bg-white ring-1 ring-gray-900/[0.06] shadow-[0_1px_2px_rgba(16,24,40,0.04),0_2px_8px_-2px_rgba(16,24,40,0.06)]'

export function PageHeader({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-gray-900">{title}</h1>
        {sub && <p className="mt-1 text-sm text-gray-500">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

/** A card with a heading row; `flush` leaves the body without padding (lists, tables). */
export function Panel({ title, icon: Icon, sub, action, flush, className, children }: {
  title: string
  icon?: LucideIcon
  sub?: React.ReactNode
  action?: React.ReactNode
  flush?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn(surface, 'overflow-hidden', className)} aria-label={title}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-navy/[0.06] text-navy">
              <Icon size={18} strokeWidth={2} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
            {sub && <p className="text-xs text-gray-500">{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={flush ? '' : 'px-5 pb-5'}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint, icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className={cn(surface, 'p-4 sm:p-5')}>
      <div className="flex items-center gap-2 text-gray-500">
        {Icon && <Icon size={15} aria-hidden />}
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'navy'

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-900 ring-amber-600/25',
  red: 'bg-red-50 text-red-800 ring-red-600/20',
  blue: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  gray: 'bg-gray-50 text-gray-700 ring-gray-500/20',
  navy: 'bg-navy/[0.06] text-navy ring-navy/15',
}
const DOTS: Record<Tone, string> = {
  green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500', gray: 'bg-gray-400', navy: 'bg-navy',
}

/** A status: always a word, with colour only as a hint. */
export function Pill({ tone, dot, children }: { tone: Tone; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone])}>
      {dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} aria-hidden />}
      {children}
    </span>
  )
}

const ICON_TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700',
  blue: 'bg-blue-50 text-blue-700', gray: 'bg-gray-100 text-gray-600', navy: 'bg-navy/[0.06] text-navy',
}

/** One line of a list: icon, what it is, details, and an amount on the right. */
export function Row({ icon: Icon, tone = 'gray', title, meta, end }: {
  icon?: LucideIcon
  tone?: Tone
  title: React.ReactNode
  meta?: React.ReactNode
  end?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      {Icon && (
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', ICON_TONES[tone])}>
          <Icon size={16} aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{title}</p>
        {meta && <p className="mt-0.5 text-xs text-gray-500">{meta}</p>}
      </div>
      {end && <div className="flex shrink-0 flex-col items-end gap-1 text-right">{end}</div>}
    </div>
  )
}

export function Rows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-gray-100 border-t border-gray-100">{children}</div>
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-gray-100 text-gray-500"><Icon size={20} aria-hidden /></span>
      <p className="mt-3 text-sm font-medium text-gray-900">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-gray-500">{children}</div>}
    </div>
  )
}

/** A thin bar for "share repaid". */
export function Progress({ value, label, tone = 'green', dark }: { value: number; label: string; tone?: 'green' | 'gold'; dark?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full', dark ? 'bg-white/15' : 'bg-gray-100')}
      role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn('h-full rounded-full', tone === 'gold' ? 'bg-gold' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-gray-200/80" />
      <div className="h-40 animate-pulse rounded-3xl bg-gray-200/80" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200/80" />)}
      </div>
    </div>
  )
}

/** Primary and secondary actions, as links or buttons. */
export const button = {
  primary: 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-navy px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60',
  gold: 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gold px-4 text-sm font-semibold text-navy-900 shadow-sm transition-colors hover:bg-[#ffc727] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60',
  secondary: 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-gray-800 ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy',
  ghostDark: 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
  link: 'inline-flex min-h-6 items-center gap-1 text-sm font-medium text-navy underline-offset-4 hover:underline',
}

/** Inputs share one look. */
export const field = 'w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-navy focus:outline-hidden'
