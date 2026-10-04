import { describe, expect, it } from 'vitest'
import { cents } from '@/lib/money'
import { broughtForward, confirmBlocker, historicalTerm, matchName, nameIndex, normalizeName } from './history'

describe('names', () => {
  it('compares letters only, ignoring case, punctuation and anything in brackets', () => {
    expect(normalizeName('  Mary-Jane  O’BRIEN (Aunt) ')).toBe('mary jane o brien')
    expect(normalizeName('(none)')).toBe('')
  })

  const index = nameIndex([
    { id: 'A1', legalName: 'Ada Lovelace', nickname: 'Ada L' },
    { id: 'B1', legalName: 'Ben Smith', nickname: null },
    { id: 'B2', legalName: 'Ben Smith', nickname: 'Benny' },
    { id: 'C1', legalName: 'Cara Jones', nickname: 'cara jones' }, // nickname the same as the name: counted once
    { id: 'X1', legalName: '(unknown)', nickname: '' },
  ])

  it('links a name only when exactly one member has it', () => {
    expect(matchName('ada lovelace', index)).toEqual({ kind: 'exact', memberId: 'A1' })
    expect(matchName('ADA L.', index)).toEqual({ kind: 'exact', memberId: 'A1' })
    expect(matchName('Cara Jones', index)).toEqual({ kind: 'exact', memberId: 'C1' })
    expect(matchName('Ben Smith', index)).toEqual({ kind: 'ambiguous', memberIds: ['B1', 'B2'] })
  })

  it('never matches part of a name', () => {
    expect(matchName('Ada', index)).toEqual({ kind: 'none' })
    expect(matchName('Ada Lovelace Smith', index)).toEqual({ kind: 'none' })
    expect(matchName('', index)).toEqual({ kind: 'none' })
  })
})

describe('terms and balances', () => {
  it('counts whole months from the loan date to the end date, 12 without one', () => {
    expect(historicalTerm('2024-03-01', '2025-03-01')).toBe(12)
    expect(historicalTerm('2024-03-15', '2024-09-01')).toBe(6)
    expect(historicalTerm('2024-03-01', '2024-03-20')).toBe(1)
    expect(historicalTerm('2024-03-01', null)).toBe(12)
  })

  it('brings forward what was repaid beyond the recorded repayments', () => {
    expect(broughtForward(cents(1000_00), cents(400_00), cents(0))).toBe(600_00)
    expect(broughtForward(cents(1000_00), cents(400_00), cents(100_00))).toBe(500_00)
    expect(broughtForward(cents(1000_00), cents(400_00), cents(700_00))).toBe(-100_00)
  })

  it('needs every name decided before a balance is confirmed', () => {
    expect(confirmBlocker({ borrowerLink: null, cosignerName: null, cosignerLink: null })).toBe('Link the borrower first.')
    expect(confirmBlocker({ borrowerLink: 'exact', cosignerName: 'Ann', cosignerLink: null })).toBe('Link the co-signer first.')
    expect(confirmBlocker({ borrowerLink: 'no_member', cosignerName: 'Ann', cosignerLink: 'reviewed' })).toBeNull()
    expect(confirmBlocker({ borrowerLink: 'reviewed', cosignerName: null, cosignerLink: null })).toBeNull()
  })
})
