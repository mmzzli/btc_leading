import { describe, expect, it } from 'vitest'
import { canTransition, transitionLoan } from './stateMachine'

describe('loan state machine', () => {
  it('supports the repayment, default and no-funding outcomes', () => {
    expect(canTransition('CollateralPending', 'Active')).toBe(true)
    expect(canTransition('CollateralPending', 'Refunded')).toBe(true)
    expect(canTransition('Active', 'RepaymentPending')).toBe(true)
    expect(canTransition('Active', 'Defaulted')).toBe(true)
  })

  it('does not allow contradictory terminal states', () => {
    expect(canTransition('Repaid', 'Defaulted')).toBe(false)
    expect(canTransition('Defaulted', 'Repaid')).toBe(false)
    expect(() => transitionLoan('Closed', 'Active')).toThrow('Invalid loan transition')
  })
})
