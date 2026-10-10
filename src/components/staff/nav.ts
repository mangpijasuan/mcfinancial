import {
  FileSpreadsheet,
  LayoutDashboard, Users, Receipt, Landmark, CreditCard, ArrowDownLeft, Bell, FileText,
  Shield, Wallet, ScrollText, KeyRound, BookOpen, CheckSquare, CalendarCheck, PiggyBank, Scale, BarChart3, type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/modules/permissions'

/** `also`: other paths that belong to this entry (a tab inside it), highlighted and permitted the same way. */
export type StaffNavItem = { href: string; label: string; icon: LucideIcon; permission: Permission | null; also?: string[] }

export type StaffNavGroup = 'Overview' | 'Members' | 'Money' | 'Lending' | 'Operations' | 'Administration' | 'Account'
export type StaffNavBadge = 'overdueLoans' | 'pendingPayments' | 'notificationTasks' | 'approvalsToDecide'
export type GroupedStaffNavItem = StaffNavItem & { group: StaffNavGroup; badge?: StaffNavBadge }

export const STAFF_NAV_GROUPS: StaffNavGroup[] = [
  'Overview', 'Members', 'Money', 'Lending', 'Operations', 'Administration', 'Account',
]

// Each admin screen and the permission needed to open it. The APIs behind
// the screens enforce the same permissions; hiding links is convenience.
export const STAFF_NAV: GroupedStaffNavItem[] = [
  { group: 'Overview',       href: '/dashboard',      label: 'Dashboard',             icon: LayoutDashboard, permission: 'dashboard.view' },
  { group: 'Members',        href: '/members',        label: 'Members',               icon: Users,           permission: 'members.read' },
  { group: 'Money',          href: '/contributions',  label: 'Contributions',         icon: Receipt,         permission: 'contributions.read' },
  { group: 'Money',          href: '/dues',           label: 'Dues',                  icon: CalendarCheck,   permission: 'contributions.read' },
  { group: 'Money',          href: '/payments',       label: 'Online Payment Review', icon: Wallet,          permission: 'payments.read', badge: 'pendingPayments' },
  { group: 'Money',          href: '/withdrawals',    label: 'Withdrawals',           icon: ArrowDownLeft,   permission: 'withdrawals.read' },
  { group: 'Money',          href: '/ledger',         label: 'Ledger',                icon: BookOpen,        permission: 'ledger.read' },
  { group: 'Money',          href: '/treasury',       label: 'Treasury',              icon: PiggyBank,       permission: 'treasury.read' },
  { group: 'Money',          href: '/reconciliation', label: 'Reconciliation',        icon: Scale,           permission: 'ledger.read' },
  { group: 'Money',          href: '/reports',        label: 'Reports',               icon: BarChart3,       permission: 'ledger.read' },
  { group: 'Lending',        href: '/loans',          label: 'Loans',                 icon: Landmark,        permission: 'loans.read', badge: 'overdueLoans', also: ['/loan-history'] },
  { group: 'Lending',        href: '/agreements',     label: 'Loan Agreements',       icon: FileText,        permission: 'agreements.read' },
  { group: 'Lending',        href: '/loan-payments',  label: 'Repayments',            icon: CreditCard,      permission: 'loan_payments.read' },
  { group: 'Operations',     href: '/approvals',      label: 'Approvals',             icon: CheckSquare,     permission: 'approvals.view', badge: 'approvalsToDecide' },
  { group: 'Operations',     href: '/notifications',  label: 'Notifications',         icon: Bell,            permission: 'notifications.read', badge: 'notificationTasks' },
  { group: 'Administration', href: '/settings/staff', label: 'Staff & Roles',         icon: Shield,          permission: 'staff.read' },
  { group: 'Administration', href: '/settings/audit', label: 'Audit Log',             icon: ScrollText,      permission: 'audit.read' },
  { group: 'Administration', href: '/settings/data',  label: 'Data Export',           icon: FileSpreadsheet, permission: 'data.export' },
  { group: 'Account',        href: '/security',       label: 'My Security',           icon: KeyRound,        permission: null },
]

export function visibleNav(permissions: readonly string[]) {
  return STAFF_NAV.filter((item) => item.permission === null || permissions.includes(item.permission))
}

/**
 * The permission a staff page needs, from the menu entry it belongs to
 * (the longest matching path, so /members/MC-1/statements needs
 * members.read). Null for pages outside the menu.
 */
export function pagePermission(path: string): Permission | null {
  const match = STAFF_NAV
    .flatMap((entry) => [entry.href, ...(entry.also ?? [])].map((href) => ({ href, permission: entry.permission })))
    .filter(({ href }) => isWithin(path, href))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.permission ?? null
}

/** The path is the page itself or one below it. */
export function isWithin(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`)
}

/** The menu entry is the current one (its own page, a page below it, or one of its tabs). */
export function navItemActive(item: StaffNavItem, path: string): boolean {
  return [item.href, ...(item.also ?? [])].some((href) => isWithin(path, href))
}

/** Where to send someone after sign-in: their first permitted screen. */
export function landingPath(permissions: readonly string[]) {
  return visibleNav(permissions)[0]?.href ?? '/security'
}
