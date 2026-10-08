// Business rules proposed with the financial safeguards that the board has
// not approved yet. Each is off until its setting is "true" (as with
// LATE_FEES_ENABLED), so the club's existing, approved rules apply until the
// board decides. Rules that keep the books right (signed terms frozen, a
// withdrawal no larger than the member's capital, Stripe payments matched
// exactly) are not here: they always apply.
export const BOARD_RULES = {
  cosignerRequired: {
    env: 'LOAN_COSIGNER_REQUIRED',
    rule: 'Every loan needs a co-signer.',
  },
  cosignerEligibility: {
    env: 'LOAN_COSIGNER_ELIGIBILITY',
    rule: 'A co-signer must be an active member of six months with no loan or co-signing of their own.',
  },
  loanTermBands: {
    env: 'LOAN_TERM_BANDS',
    rule: 'Loans up to $2,500 run at most 12 months; larger loans at most 24.',
  },
  withdrawalBlockedByLoans: {
    env: 'WITHDRAWAL_BLOCKED_BY_LOANS',
    rule: 'A member with an active loan or co-signing obligation cannot make a partial withdrawal. (A full exit is always blocked.)',
  },
  withdrawalLiquidity: {
    env: 'WITHDRAWAL_LIQUIDITY_CHECK',
    rule: 'A withdrawal needs a recorded bank balance and must fit within bank cash after committed loan payouts.',
  },
  fullExitWholeBalance: {
    env: 'FULL_EXIT_WHOLE_BALANCE',
    rule: 'A full exit pays out the member’s whole available capital.',
  },
} as const

export type BoardRule = keyof typeof BOARD_RULES

export function boardRuleOn(rule: BoardRule): boolean {
  return process.env[BOARD_RULES[rule].env] === 'true'
}

/** Every rule and whether it is on, for screens and documentation. */
export function boardRules(): { key: BoardRule; env: string; rule: string; on: boolean }[] {
  return (Object.keys(BOARD_RULES) as BoardRule[]).map((key) => ({ key, ...BOARD_RULES[key], on: boardRuleOn(key) }))
}
