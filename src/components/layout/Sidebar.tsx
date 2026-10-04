'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  STAFF_NAV_GROUPS,
  visibleNav,
  type GroupedStaffNavItem,
  type StaffNavBadge,
} from '@/components/staff/nav'
import { APP_NAME } from '@/lib/brand'

type BadgeCounts = Record<StaffNavBadge, number>

const EMPTY_BADGES: BadgeCounts = {
  overdueLoans: 0,
  pendingPayments: 0,
  notificationTasks: 0,
}

function badgeLabel(count: number) {
  return count > 99 ? '99+' : String(count)
}

// Defined at module level: a component declared inside another is a new
// type on every render, so React would remount it (and its links) each time.
function NavLink({ item, compact, path, badges }: { item: GroupedStaffNavItem; compact: boolean; path: string; badges: BadgeCounts }) {
  const active = path === item.href || path.startsWith(`${item.href}/`)
  const count = item.badge ? badges[item.badge] : 0
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      title={compact ? item.label : undefined}
      className={cn(
        'relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        compact && 'justify-center px-2',
        active
          ? 'bg-white/15 font-medium text-white'
          : 'text-white/60 hover:bg-white/10 hover:text-white'
      )}
    >
      <Icon size={17} className="shrink-0" />
      {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {count > 0 && (
        <span className={cn(
          'inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950',
          compact && 'absolute right-0.5 top-0.5 min-w-4 px-1'
        )} aria-label={`${count} items need attention`}>
          {badgeLabel(count)}
        </span>
      )}
    </Link>
  )
}

type NavProps = {
  path: string
  badges: BadgeCounts
  roleSummary?: string
  quickAction: { href: string; label: string } | null
  mainItems: GroupedStaffNavItem[]
  accountItems: GroupedStaffNavItem[]
  onToggleCollapsed: () => void
}

function NavContent({ compact = false, desktop = false, path, badges, roleSummary, quickAction, mainItems, accountItems, onToggleCollapsed }: NavProps & { compact?: boolean; desktop?: boolean }) {
  return (
    <>
      <div className="shrink-0 border-b border-white/10 px-3 py-4">
        <div className={cn('flex min-w-0 items-center', compact ? 'justify-center' : 'gap-3')}>
          {desktop && (
            <button
              onClick={onToggleCollapsed}
              className="shrink-0 rounded-lg p-1.5 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!compact}
              title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          )}
          <img
            src="/mc-logo.png"
            alt={APP_NAME}
            className={cn('shrink-0 object-contain', compact ? 'h-7 w-10' : 'h-8 w-12')}
          />
          {!compact && (
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-semibold leading-tight text-white">{APP_NAME}</p>
              <p className="truncate text-xs text-white/45">{roleSummary || 'Staff'}</p>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
        {quickAction && (
          <Link
            href={quickAction.href}
            title={compact ? quickAction.label : undefined}
            aria-label={compact ? quickAction.label : undefined}
            className={cn(
              'mb-4 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-[#1B2A4A] transition-colors hover:bg-amber-300',
              compact && 'px-2'
            )}
          >
            <Plus size={17} />
            {!compact && quickAction.label}
          </Link>
        )}

        <nav aria-label="Staff navigation">
          {STAFF_NAV_GROUPS.filter((group) => group !== 'Account').map((group) => {
            const groupItems = mainItems.filter((item) => item.group === group)
            if (!groupItems.length) return null
            return (
              <div key={group} className={cn('mb-4', compact && 'border-b border-white/10 pb-3 last:border-0')}>
                {!compact && <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{group}</p>}
                <div className="space-y-0.5">
                  {groupItems.map((item) => <NavLink key={item.href} item={item} compact={compact} path={path} badges={badges} />)}
                </div>
              </div>
            )
          })}
        </nav>
      </div>

      <div className="shrink-0 space-y-0.5 border-t border-white/10 p-2">
        {accountItems.map((item) => <NavLink key={item.href} item={item} compact={compact} path={path} badges={badges} />)}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className={cn(
            'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white',
            compact && 'justify-center px-2'
          )}
          aria-label={compact ? 'Sign out' : undefined}
          title={compact ? 'Sign out' : undefined}
        >
          <LogOut size={17} className="shrink-0" />
          {!compact && 'Sign out'}
        </button>
      </div>
    </>
  )
}

export default function Sidebar({ permissions, roleSummary }: { permissions: string[]; roleSummary?: string }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [badges, setBadges] = useState<BadgeCounts>(EMPTY_BADGES)
  const drawerRef = useRef<HTMLElement>(null)
  const permissionKey = permissions.join('|')
  const permitted = new Set(permissions)
  const items = visibleNav(permissions)
  const accountItems = items.filter((item) => item.group === 'Account')
  const mainItems = items.filter((item) => item.group !== 'Account')

  const quickAction = permitted.has('members.create')
    ? { href: '/members?new=1', label: 'Add member' }
    : permitted.has('contributions.record')
      ? { href: '/contributions?new=1', label: 'Record contribution' }
      : permitted.has('loans.create')
        ? { href: '/loans?new=1', label: 'New loan' }
        : null

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('mcfinancial.sidebar.collapsed') === 'true')
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [path])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const drawer = drawerRef.current
    document.body.style.overflow = 'hidden'
    drawer?.querySelector<HTMLElement>('a, button')?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !drawer) return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('a, button:not([disabled])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
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

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    const permitted = new Set(permissionKey.split('|'))
    async function loadBadges() {
      const next = { ...EMPTY_BADGES }
      const requests: Promise<void>[] = []

      if (permitted.has('loans.read')) {
        requests.push(fetch('/api/loans?status=Active', { cache: 'no-store', signal: controller.signal })
          .then((res) => res.ok ? res.json() : [])
          .then((loans) => { next.overdueLoans = Array.isArray(loans) ? loans.filter((loan) => loan.overdue).length : 0 }))
      }
      if (permitted.has('payments.read')) {
        requests.push(fetch('/api/payments?status=pending', { cache: 'no-store', signal: controller.signal })
          .then((res) => res.ok ? res.json() : null)
          .then((data) => { next.pendingPayments = Array.isArray(data?.payments) ? data.payments.length : 0 }))
      }
      if (permitted.has('notifications.read')) {
        requests.push(fetch('/api/notifications', { cache: 'no-store', signal: controller.signal })
          .then((res) => res.ok ? res.json() : null)
          .then((data) => {
            next.notificationTasks = (Array.isArray(data?.unpaidMembers) ? data.unpaidMembers.length : 0)
              + (Array.isArray(data?.overdueLoans) ? data.overdueLoans.length : 0)
          }))
      }

      await Promise.allSettled(requests)
      if (active) setBadges(next)
    }

    loadBadges()
    const interval = window.setInterval(loadBadges, 60_000)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(interval)
    }
  }, [permissionKey])

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current
      window.localStorage.setItem('mcfinancial.sidebar.collapsed', String(next))
      return next
    })
  }

  const navProps: NavProps = { path, badges, roleSummary, quickAction, mainItems, accountItems, onToggleCollapsed: toggleCollapsed }

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-white/10 bg-[#1B2A4A] px-4 lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={() => setOpen((current) => !current)}
            className="-ml-2 shrink-0 rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-staff-navigation"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <img src="/mc-logo.png" alt={APP_NAME} className="h-7 w-11 shrink-0 object-contain" />
          <span className="truncate text-sm font-semibold text-white">{APP_NAME}</span>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/45" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside
            ref={drawerRef}
            id="mobile-staff-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Staff menu"
            className="relative flex h-dvh w-72 max-w-[88vw] flex-col bg-[#1B2A4A] shadow-2xl"
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            <NavContent {...navProps} />
          </aside>
        </div>
      )}

      <aside className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col bg-[#1B2A4A] transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[72px]' : 'w-64'
      )}>
        <NavContent {...navProps} compact={collapsed} desktop />
      </aside>
    </>
  )
}
