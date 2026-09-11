import { describe, expect, it } from 'vitest'
import { exampleLoanTerms } from './fixtures'
import {
  canonicalizeLoanTerms,
  hashLoanTerms,
  loanIdFromTerms,
  validateLoanTerms,
} from './loanTerms'

describe('loan terms', () => {
  it('produces the frozen canonical form, hash and loan id', () => {
    expect(canonicalizeLoanTerms(exampleLoanTerms)).toBe(JSON.stringify(exampleLoanTerms))
    expect(hashLoanTerms(exampleLoanTerms)).toBe(
      'e813da992343b74501b46d24815c11dccc7a9c226421cf3612852a516caebe3b',
    )
    expect(loanIdFromTerms(exampleLoanTerms)).toBe('loan_e813da992343b74501b46d24')
    expect(validateLoanTerms(exampleLoanTerms)).toEqual([])
  })

  it('changes identity when any economic term changes', () => {
    const changed = { ...exampleLoanTerms, interestSats: 501 }
    expect(hashLoanTerms(changed)).not.toBe(hashLoanTerms(exampleLoanTerms))
  })

  it('rejects unsupported and unsafe input', () => {
    const invalid = {
      ...exampleLoanTerms,
      runeId: 'not-a-rune',
      collateralAmount: '0',
      principalSats: 0,
      loanTermBlocks: 65_536,
      lenderPubkey: exampleLoanTerms.borrowerPubkey,
    }
    expect(validateLoanTerms(invalid)).toHaveLength(5)
  })
})
