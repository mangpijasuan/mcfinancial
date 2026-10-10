import { describe, expect, it } from 'vitest'
import { eligibilityText } from '@/lib/utils'

describe('eligibilityText: stored loan-eligibility codes in plain words', () => {
  it('names the known reasons', () => {
    expect(eligibilityText('YES')).toBe('Eligible')
    expect(eligibilityText('NO - Active Loan/Cosign')).toBe('You have a loan, or co-sign one, still being repaid.')
    expect(eligibilityText('NO - Need 6 Months', true)).toBe('Under 6 months')
    expect(eligibilityText('NO - Need 6 Months')).toBe('Members can borrow after 6 months of membership.')
  })

  it('never shows the raw code, even a bare "NO"', () => {
    expect(eligibilityText('NO')).toBe('Not eligible now.')
    expect(eligibilityText('NO', true)).toBe('Not eligible')
    expect(eligibilityText('no')).toBe('Not eligible now.')
    expect(eligibilityText(null)).toBe('Not eligible now.')
  })

  it('keeps an unknown reason, without its code', () => {
    expect(eligibilityText('NO - Board hold')).toBe('Not eligible now: Board hold.')
    expect(eligibilityText('NO - Board hold', true)).toBe('Board hold')
  })
})
