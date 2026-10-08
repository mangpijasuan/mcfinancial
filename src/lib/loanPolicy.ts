// Millionaires Club Loan Policy (2025)
// Source: 2025___MC_Loan_Policy_and_Terms.docx

export const POLICY = {
  MIN_MONTHS_ACTIVE:         6,       // 6 months membership before first loan
  MAX_LOAN_AMOUNT:           5000,    // Hard cap
  LOAN_MULTIPLE:             4,       // Max loan = 4× contributions
  COOLDOWN_MONTHS:           3,       // Months to wait after paying off a loan
  LATE_FEE:                  5,       // $5 late fee
  PAYMENT_DUE_DAY:           10,      // 10th of each month
  LATE_FEE_GRACE_DAYS:       15,      // Days before late fee kicks in
}

/** Terms up to 12 months; amounts above $2,500 may run up to 24. */
export function validLoanTerms(amount: number, termMonths: number): boolean {
  return Number.isFinite(amount) && amount > 0 && amount <= POLICY.MAX_LOAN_AMOUNT
    && Number.isInteger(termMonths) && termMonths > 0
    && termMonths <= (amount <= 2500 ? 12 : 24)
}

// Application fees per policy section 3
export function calcApplicationFee(amount: number, termMonths: number): number {
  if (!validLoanTerms(amount, termMonths)) throw new RangeError('Unsupported loan amount or term.')
  if (amount <= 2500) return 30
  if (amount > 2500 && termMonths <= 12)  return 50
  if (amount > 2500 && termMonths <= 24)  return 70
  return 70
}

export interface PolicyCheckResult {
  eligible: boolean
  errors: string[]
  warnings: string[]
  maxLoanAmount: number
  applicationFee: number
}

export function checkLoanPolicy(
  member: {
    id: string
    status: string
    monthsActive: number
    archiveLifetime: number
    contributions2026: number
    /** Contributions from the ledger, when screens read from it (M6); otherwise archive + tracked. */
    contributions?: number
    activeAsBorrower: number
    activeAsCosigner: number
    eligible: string
  },
  requestedAmount: number,
  termMonths: number,
  lastLoanPaidOffDate?: Date | null
): PolicyCheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. Must be active
  if (member.status !== 'Active') {
    errors.push('Member is not active.')
  }

  // 2. Minimum 6 months membership
  if (member.monthsActive < POLICY.MIN_MONTHS_ACTIVE) {
    errors.push(`Member must be active for at least ${POLICY.MIN_MONTHS_ACTIVE} months. Currently: ${member.monthsActive} months.`)
  }

  // 3. No existing active loan or co-sign
  if (member.activeAsBorrower > 0) {
    errors.push('Member already has an active loan. Must pay it off first.')
  }
  if (member.activeAsCosigner > 0) {
    errors.push('Member is already a co-signer on an active loan.')
  }

  // 4. Max loan amount = 4× contributions (cap $5,000)
  const totalContribs = member.contributions ?? (member.archiveLifetime || 0) + (member.contributions2026 || 0)
  const maxByContrib  = Math.min(totalContribs * POLICY.LOAN_MULTIPLE, POLICY.MAX_LOAN_AMOUNT)
  if (requestedAmount > maxByContrib) {
    errors.push(`Requested amount ($${requestedAmount.toLocaleString()}) exceeds maximum ($${maxByContrib.toLocaleString()}) based on contributions × ${POLICY.LOAN_MULTIPLE}.`)
  }

  // 5. 3-month cooldown after paying off previous loan
  if (lastLoanPaidOffDate) {
    const monthsSincePaidOff = Math.floor(
      (Date.now() - new Date(lastLoanPaidOffDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
    )
    if (monthsSincePaidOff < POLICY.COOLDOWN_MONTHS) {
      const remaining = POLICY.COOLDOWN_MONTHS - monthsSincePaidOff
      errors.push(`Must wait ${POLICY.COOLDOWN_MONTHS} months after paying off a loan. ${remaining} month(s) remaining.`)
    }
  }

  const termsValid = validLoanTerms(requestedAmount, termMonths)
  if (!termsValid) errors.push('Loans up to $2,500 require 1–12 months; larger loans up to $5,000 require 1–24 months.')
  const applicationFee = termsValid ? calcApplicationFee(requestedAmount, termMonths) : 0

  if (errors.length === 0 && requestedAmount > maxByContrib * 0.8) {
    warnings.push(`Loan is ${Math.round((requestedAmount / maxByContrib) * 100)}% of the maximum allowed amount.`)
  }

  return {
    eligible: errors.length === 0,
    errors,
    warnings,
    maxLoanAmount: maxByContrib,
    applicationFee,
  }
}
