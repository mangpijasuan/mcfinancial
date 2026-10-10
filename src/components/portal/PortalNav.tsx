'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useEffect, useRef, useState } from 'react'
import { CreditCard, FileSignature, FileText, History, Home, Landmark, LogOut, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { APP_NAME } from '@/lib/brand'

type Item = { href: string; label: string; short: string; icon: LucideIcon }

const NAV: Item[] = [
  { href: '/portal/dashboard', label: 'Dashboard', short: 'Home', icon: Home },
  { href: '/portal/pay', label: 'Make a Payment', short: 'Pay', icon: CreditCard },
  { href: '/portal/history', label: 'Payment History', short: 'History', icon: History },
  { href: '/portal/loan', label: 'My Loan', short: 'Loan', icon: Landmark },
  { href: '/portal/statements', label: 'Statements', short: 'Statements', icon: FileText },
  { href: '/portal/agreements', label: 'Loan Agreements', short: 'Agreements', icon: FileSignature },
]
// On phones the first four sit in the tab bar; the rest open from "More".
const TABS = NAV.slice(0, 4)
const MORE = NAV.slice(4)

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`)

function initials(name?: string) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || 'M'
}

/** Closes a popover on Escape or a click outside it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open, close])
  return ref
}

function AccountMenu({ user }: { user: { name?: string; memberId?: string } }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true" aria-controls="portal-account"
        aria-label="Your account"
        className="flex items-center gap-2.5 rounded-full p-1 pr-1 xl:pr-3 text-left text-white/90 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-gold text-xs font-bold text-navy-900">{initials(user.name)}</span>
        <span className="hidden xl:block leading-tight">
          <span className="block text-sm font-medium text-white">{user.name}</span>
          <span className="block text-[11px] text-white/80">{user.memberId}</span>
        </span>
      </button>
      {open && (
        <div id="portal-account" className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-gray-900/10">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">{user.name}</p>
            <p className="text-xs text-gray-500">Member ID {user.memberId}</p>
          </div>
          <button
            type="button" onClick={() => signOut({ callbackUrl: '/portal/login' })}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function MoreTab({ path }: { path: string }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const active = MORE.some((i) => isActive(path, i.href))
  return (
    <div ref={ref} className="relative flex">
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="portal-more"
        className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium', active || open ? 'text-navy' : 'text-gray-600')}
      >
        <MoreHorizontal size={22} aria-hidden />
        More
      </button>
      {open && (
        <div id="portal-more" className="absolute bottom-full right-2 mb-3 w-56 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-gray-900/10">
          {MORE.map((item) => (
            <Link
              key={item.href} href={item.href} onClick={() => setOpen(false)}
              aria-current={isActive(path, item.href) ? 'page' : undefined}
              className={cn('flex items-center gap-3 px-4 py-3 text-sm font-medium', isActive(path, item.href) ? 'bg-navy/[0.05] text-navy' : 'text-gray-700 hover:bg-gray-50')}
            >
              <item.icon size={18} aria-hidden /> {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PortalNav({ user }: { user: { name?: string; memberId?: string } }) {
  const path = usePathname()

  return (
    <>
      <header className="sticky top-0 z-40 bg-navy/95 backdrop-blur supports-[backdrop-filter]:bg-navy/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/portal/dashboard" className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-white">
            <img src="/brand/mc-logo-on-dark.svg" alt="" className="h-7 w-11 shrink-0 object-contain" />
            {/* Beside the full menu there is room for the name only on wide screens. */}
            <span className="min-w-0 leading-tight lg:sr-only 2xl:not-sr-only">
              <span className="block truncate text-sm font-semibold text-white">{APP_NAME}</span>
              <span className="block text-[11px] text-white/80">Member portal</span>
            </span>
          </Link>

          <nav aria-label="Member portal" className="hidden lg:block">
            <ul className="flex items-center gap-1 rounded-2xl bg-white/[0.06] p-1">
              {NAV.map((item) => {
                const active = isActive(path, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href} aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                        active ? 'bg-white text-navy shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <item.icon size={16} aria-hidden /> {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          <AccountMenu user={user} />
        </div>
      </header>

      <nav aria-label="Member portal tabs" className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
          {TABS.map((item) => {
            const active = isActive(path, item.href)
            return (
              <Link
                key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                className={cn('relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-navy' : 'text-gray-600')}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" aria-hidden />}
                <item.icon size={22} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                {item.short}
              </Link>
            )
          })}
          <MoreTab path={path} />
        </div>
      </nav>
    </>
  )
}
