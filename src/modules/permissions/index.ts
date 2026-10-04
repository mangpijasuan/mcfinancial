// Permission catalogue and role definitions (D-07). Role *definitions*
// live here, in code, so every change is reviewed in git and exercised by
// the authorisation-matrix tests. Role *assignments* live in the database
// (StaffRoleAssignment) and are read on every request, so granting or
// revoking a role takes effect immediately.
//
// The matrix follows docs/architecture/05-security-and-privacy.md
// ("RBAC and maker/checker"). Approval steps that need maker/checker
// (Stage 3) are, for now, plain permissions held by the approving roles.

export const PERMISSIONS = {
  'dashboard.view': 'See the dashboard and club-wide totals',
  'members.read': 'View member records',
  'members.create': 'Add members',
  'members.update': 'Edit member details and status',
  'members.portal_access': 'Turn member portal access on or off and set portal passwords',
  'contributions.read': 'View contributions',
  'contributions.record': 'Record contributions',
  'contributions.reverse': 'Propose reversing a mistaken contribution (needs a checker)',
  'contributions.approve_reversal': 'Approve a contribution reversal proposed by someone else',
  'dues.manage_plans': 'Change a member’s monthly dues amount from a future month',
  'loans.read': 'View loans and loan history',
  'loans.create': 'Create loan applications (with their agreements)',
  'loans.update': 'Edit loan notes and flags',
  'loans.cancel': 'Cancel a loan before any repayment',
  'loans.link_history': 'Link older (2021–2025) loans to members and confirm the balances of those still open (M9)',
  'loan_payments.read': 'View loan repayments',
  'loan_payments.record': 'Record loan repayments',
  'agreements.read': 'View loan agreements',
  'agreements.update': 'Fill in agreement details (borrower address)',
  'agreements.sign_lender': 'Sign agreements on behalf of the club',
  'withdrawals.read': 'View withdrawals',
  'withdrawals.record': 'Record withdrawals and full exits',
  'payments.read': 'View member online payments',
  'payments.review': 'Confirm or reject Zelle claims',
  'notifications.read': 'View notification previews and history',
  'notifications.send': 'Send reminder and summary emails',
  'ledger.read': 'View the chart of accounts, journal and trial balance',
  'ledger.manage_accounts': 'Record the accountant’s approval of the chart of accounts',
  'ledger.propose': 'Propose manual journal entries (they need a checker)',
  'ledger.approve': 'Approve manual journal entries proposed by someone else',
  'treasury.read': 'View the cash position, the cash reserve and the lending capacity',
  'treasury.record_balance': 'Record the club’s bank balance from the bank statement',
  'treasury.approve_balance': 'Approve a bank balance recorded by someone else (when maker/checker is on)',
  'treasury.record_transfer': 'Record money moved to the bank: a Stripe payout, transfers swept, a collector’s cash deposit',
  'treasury.approve_transfer': 'Approve a transfer to the bank recorded by someone else (when maker/checker is on)',
  'ledger.reconcile': 'Reconcile the bank statement against the ledger each month',
  'ledger.close_period': 'Close a month once it is reconciled (nothing can post into it afterwards)',
  'loans.approve': 'Approve loans proposed by someone else (when maker/checker is on)',
  'withdrawals.approve': 'Approve withdrawals recorded by someone else (when maker/checker is on)',
  'loans.disburse': 'Record that a loan was paid out to the borrower',
  'loans.approve_disbursement': 'Approve a loan payout recorded by someone else (when maker/checker is on)',
  'loan_fees.waive': 'Propose waiving a late fee (needs a checker)',
  'loan_fees.approve_waiver': 'Approve a late-fee waiver proposed by someone else',
  'loans.write_off': 'Propose writing off a delinquent loan (needs two Board approvals)',
  'loans.approve_write_off': 'Approve a loan write-off proposed by someone else',
  'approvals.view': 'See the approval queue',
  'audit.read': 'Read the audit log',
  'staff.read': 'View staff accounts and their roles',
  'staff.manage': 'Create staff accounts, assign roles, reset passwords and MFA',
} as const

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

const READ_EVERYTHING: Permission[] = [
  'dashboard.view', 'members.read', 'contributions.read', 'loans.read', 'loan_payments.read',
  'agreements.read', 'withdrawals.read', 'payments.read', 'notifications.read', 'ledger.read',
  'approvals.view', 'treasury.read',
]

type RoleDefinition = {
  label: string
  description: string
  permissions: readonly Permission[]
  /** Only a Super Admin may grant, revoke or act on accounts holding this role. */
  privileged?: boolean
  /** Kept only until the founder assigns the officer roles (Gate #1 A4). */
  transitional?: boolean
}

export const ROLES = {
  loan_officer: {
    label: 'Loan Officer',
    description: 'Takes and reviews loan applications.',
    permissions: [
      'dashboard.view', 'members.read', 'contributions.read', 'loans.read', 'loans.create',
      'loan_payments.read', 'agreements.read', 'agreements.update', 'approvals.view', 'loan_fees.waive',
      'treasury.read',
    ],
  },
  finance: {
    label: 'Finance',
    description: 'Records contributions, repayments and withdrawals; edits member contact details.',
    permissions: [
      ...READ_EVERYTHING, 'members.update', 'contributions.record', 'loan_payments.record',
      'withdrawals.record', 'notifications.send', 'ledger.propose', 'contributions.reverse', 'treasury.record_transfer',
    ],
  },
  treasurer: {
    label: 'Treasurer',
    description: 'Records and approves financial entries, confirms Zelle claims, signs for the club.',
    permissions: [
      ...READ_EVERYTHING, 'contributions.record', 'loan_payments.record', 'withdrawals.record',
      'payments.review', 'agreements.sign_lender', 'loans.update', 'loans.cancel', 'audit.read',
      'ledger.manage_accounts', 'ledger.propose', 'ledger.approve', 'loans.approve', 'withdrawals.approve',
      'loans.disburse', 'loan_fees.waive', 'loan_fees.approve_waiver', 'loans.write_off',
      'contributions.reverse', 'contributions.approve_reversal', 'dues.manage_plans', 'treasury.record_balance',
      'treasury.record_transfer', 'treasury.approve_transfer', 'ledger.reconcile', 'ledger.close_period',
      'loans.link_history',
    ],
  },
  compliance: {
    label: 'Compliance',
    description: 'Read-only access to members and finance, plus the audit log.',
    permissions: [...READ_EVERYTHING, 'audit.read', 'staff.read'],
  },
  auditor: {
    label: 'Auditor',
    description: 'Read-only access to everything, including the audit log.',
    permissions: [...READ_EVERYTHING, 'audit.read', 'staff.read'],
  },
  board: {
    label: 'Board',
    description: 'Oversight and approvals: confirms payments, signs agreements, reads the audit log.',
    permissions: [
      ...READ_EVERYTHING, 'payments.review', 'agreements.sign_lender', 'audit.read', 'staff.read', 'loans.approve', 'ledger.approve',
      'loans.approve_disbursement', 'loans.approve_write_off', 'treasury.approve_balance',
    ],
  },
  administrator: {
    label: 'Administrator',
    description: 'Manages member records and staff accounts. No financial rights.',
    permissions: ['members.read', 'members.create', 'members.update', 'members.portal_access', 'staff.read', 'staff.manage'],
  },
  super_admin: {
    label: 'Super Admin',
    description: 'Break-glass: every permission. Every sign-in is flagged in the audit log.',
    permissions: ALL_PERMISSIONS,
    privileged: true,
  },
  club_officer: {
    label: 'Club Officer (transitional)',
    description: 'The access every admin had before roles existed. Replace with specific roles once officers are named.',
    permissions: ALL_PERMISSIONS.filter((p) => !['audit.read', 'staff.read', 'staff.manage', 'ledger.manage_accounts', 'loans.link_history'].includes(p)),
    transitional: true,
  },
} satisfies Record<string, RoleDefinition>

export type RoleKey = keyof typeof ROLES

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[]

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLES, value)
}

export function isPrivilegedRole(role: string): boolean {
  return isRoleKey(role) && Boolean((ROLES[role] as RoleDefinition).privileged)
}

/** The union of permissions granted by the given roles; unknown role keys grant nothing. */
export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const granted = new Set<Permission>()
  for (const role of roles) {
    if (!isRoleKey(role)) continue
    for (const permission of ROLES[role].permissions) granted.add(permission)
  }
  return granted
}

export function roleLabel(role: string): string {
  return isRoleKey(role) ? ROLES[role].label : role
}
