import type { ImportKind } from '@/modules/data/import'
import type { Permission } from '@/modules/permissions'

// What each spreadsheet upload expects, for its card (ImportPanel): the
// columns, a sample file, and how its button and result are worded.
export type ImportSetup = {
  kind: ImportKind
  /** The API path under /api/data/import/. */
  path: string
  permission: Permission
  title: string
  intro: string
  /** The point to read before uploading, shown highlighted. */
  note?: string
  columns: { name: string; note: string }[]
  sample: string
  /** The button: "Record 3 contributions". */
  verb: (n: number) => string
  /** The result: "Imported (IMP-…): 3 added." */
  done: (r: { publicId: string; added: number; updated: number }) => string
  back: { href: string; label: string }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const IMPORT_SETUPS: Record<ImportKind, ImportSetup> = {
  members: {
    kind: 'members', path: 'members', permission: 'members.create',
    title: 'Import members',
    intro: 'Add new members, or update the contact details of existing ones, from a spreadsheet saved as CSV. A Members file downloaded from Data Export can be edited and imported back.',
    columns: [
      { name: 'Member ID', note: 'Empty for a new member (the app gives the next number); the ID for an update.' },
      { name: 'Legal name', note: 'Required for a new member. Names of existing members are changed in the app, not by import.' },
      { name: 'Joined', note: 'Required for a new member: YYYY-MM-DD or M/D/YYYY.' },
      { name: 'Nickname, Phone, Email, Beneficiary', note: 'Optional. An empty cell leaves the detail as it is: an import never erases.' },
    ],
    sample: 'Member ID,Legal name,Joined,Nickname,Phone,Email,Beneficiary\r\n,Jane Example,2026-10-01,,555-0100,jane@example.com,\r\n',
    verb: (n) => `Import ${plural(n, 'member')}`,
    done: (r) => `Imported (${r.publicId}): ${r.added} added, ${r.updated} updated.`,
    back: { href: '/members', label: 'Members' },
  },
  contributions: {
    kind: 'contributions', path: 'contributions', permission: 'contributions.record',
    title: 'Import contributions',
    intro: 'Record a batch of contributions from a spreadsheet saved as CSV. Each one is recorded exactly as if typed in: receipt, monthly dues and the ledger.',
    note: 'Only contributions not yet in the app belong in the file. Rows that look already recorded (same member, date and amount) are flagged in the preview.',
    columns: [
      { name: 'Member ID', note: 'Required, e.g. MC-10001.' },
      { name: 'Paid on', note: 'Required: YYYY-MM-DD or M/D/YYYY. Not in the future.' },
      { name: 'Amount', note: 'Required, in dollars: 20 or 20.00 or $1,200.50.' },
      { name: 'Method, Kind, Received by, Note', note: 'Optional. Kind is "dues" (the default) or "voluntary".' },
    ],
    sample: 'Member ID,Paid on,Amount,Method,Kind,Received by,Note\r\nMC-10001,2026-10-05,20.00,Zelle,dues,,\r\n',
    verb: (n) => `Record ${plural(n, 'contribution')}`,
    done: (r) => `Imported (${r.publicId}): ${r.added} added.`,
    back: { href: '/contributions', label: 'Contributions' },
  },
  contribution_reversals: {
    kind: 'contribution_reversals', path: 'contribution-reversals', permission: 'contributions.reverse',
    title: 'Reverse contributions',
    intro: 'Reverse mistaken contributions in a batch, by receipt number. A reversed contribution stays on record, marked reversed, and stops counting.',
    note: 'Nothing is reversed straight away: each reversal is sent to Approvals, and a second person (the Treasurer) approves it, as when proposed one at a time.',
    columns: [
      { name: 'Receipt', note: 'Required: the receipt number (RC-2026-000123), or the CON- number of a contribution without one.' },
      { name: 'Reason', note: 'Required: why it is being reversed, e.g. "Recorded twice".' },
    ],
    sample: 'Receipt,Reason\r\nRC-2026-000123,Recorded twice\r\n',
    verb: (n) => `Send ${plural(n, 'reversal')} for approval`,
    done: (r) => `Sent for approval (${r.publicId}): ${plural(r.added, 'reversal')}. They take effect once approved in Approvals.`,
    back: { href: '/approvals', label: 'Approvals' },
  },
  loan_payments: {
    kind: 'loan_payments', path: 'loan-payments', permission: 'loan_payments.record',
    title: 'Import loan repayments',
    intro: 'Record a batch of loan repayments from a spreadsheet saved as CSV. Each one is recorded exactly as if typed in on the Repayments page: the loan’s balance, schedule and the ledger.',
    note: 'Only repayments not yet in the app belong in the file. A repayment can’t be more than pays the loan off; rows that look already recorded are flagged in the preview.',
    columns: [
      { name: 'Loan ID', note: 'Required: the loan’s ID, as on the Loans page.' },
      { name: 'Paid on', note: 'Required: YYYY-MM-DD or M/D/YYYY. Not in the future.' },
      { name: 'Amount', note: 'Required, in dollars: 100 or 100.00.' },
      { name: 'Method, Received by, Note', note: 'Optional.' },
    ],
    sample: 'Loan ID,Paid on,Amount,Method,Received by,Note\r\nL02,2026-10-05,100.00,Zelle,,\r\n',
    verb: (n) => `Record ${plural(n, 'repayment')}`,
    done: (r) => `Imported (${r.publicId}): ${r.added} added.`,
    back: { href: '/loan-payments', label: 'Repayments' },
  },
}

/** The uploads on the Bulk Upload page, in order. */
export const BULK_UPLOADS: ImportKind[] = ['contributions', 'contribution_reversals', 'loan_payments', 'members']
