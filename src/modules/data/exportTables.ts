// The tables that can be exported: names and descriptions only, so the
// staff page can list them without loading any database code.
export const EXPORTS = {
  members: { title: 'Members', description: 'Every member: contact details, status, and contribution totals.' },
  contributions: { title: 'Contributions', description: 'Every contribution recorded in the app, with its receipt.' },
  loans: { title: 'Loans', description: 'Every loan with its borrower, co-signer, terms and balance.' },
  repayments: { title: 'Loan repayments', description: 'Every loan repayment.' },
  older_loans: { title: 'Older loans (2021–2025)', description: 'The loans from the club’s earlier records.' },
  withdrawals: { title: 'Withdrawals', description: 'Every withdrawal of member capital.' },
  ledger: { title: 'Ledger', description: 'Every ledger line: date, entry, account, debit and credit.' },
} as const

export type ExportKey = keyof typeof EXPORTS
export const EXPORT_KEYS = Object.keys(EXPORTS) as ExportKey[]
export const isExportKey = (v: unknown): v is ExportKey => typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXPORTS, v)
