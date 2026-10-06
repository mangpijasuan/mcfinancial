import {
  LayoutDashboard, Users, Receipt, Landmark, CreditCard, History, ArrowDownLeft, Bell, FileText,
  Shield, Wallet, ScrollText, KeyRound, BookOpen, CheckSquare, CalendarCheck, PiggyBank, Scale, BarChart3, type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/modules/permissions'

export type StaffNavItem = { href: string; label: string; icon: LucideIcon; permission: Permission | null }

export type StaffNavGroup = 'Overview' | 'Members' | 'Money' | 'Lending' | 'Operations' | 'Administration' | 'Account'
export type StaffNavBadge = 'overdueLoans' | 'pendingPayments' | 'notificationTasks'
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
  { group: 'Lending',        href: '/loans',          label: 'Loans',                 icon: Landmark,        permission: 'loans.read', badge: 'overdueLoans' },
  { group: 'Lending',        href: '/agreements',     label: 'Loan Agreements',       icon: FileText,        permission: 'agreements.read' },
  { group: 'Lending',        href: '/loan-payments',  label: 'Repayments',            icon: CreditCard,      permission: 'loan_payments.read' },
  { group: 'Lending',        href: '/loan-history',   label: 'Loan History',          icon: History,         permission: 'loans.read' },
  { group: 'Operations',     href: '/approvals',      label: 'Approvals',             icon: CheckSquare,     permission: 'approvals.view' },
  { group: 'Operations',     href: '/notifications',  label: 'Notifications',         icon: Bell,            permission: 'notifications.read', badge: 'notificationTasks' },
  { group: 'Administration', href: '/settings/staff', label: 'Staff & Roles',         icon: Shield,          permission: 'staff.read' },
  { group: 'Administration', href: '/settings/audit', label: 'Audit Log',             icon: ScrollText,      permission: 'audit.read' },
  { group: 'Account',        href: '/security',       label: 'My Security',           icon: KeyRound,        permission: null },
]

export function visibleNav(permissions: readonly string[]) {
  return STAFF_NAV.filter((item) => item.permission === null || permissions.includes(item.permission))
}

/** Where to send someone after sign-in: their first permitted screen. */
export function landingPath(permissions: readonly string[]) {
  return visibleNav(permissions)[0]?.href ?? '/security'
}
