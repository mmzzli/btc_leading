export const loanStates = [
  'Draft',
  'Offered',
  'Accepted',
  'CollateralPending',
  'Active',
  'RepaymentPending',
  'Repaid',
  'Defaulted',
  'Refunded',
  'Closed',
] as const

export type LoanState = (typeof loanStates)[number]

export const allowedTransitions: Readonly<Record<LoanState, readonly LoanState[]>> = {
  Draft: ['Offered'],
  Offered: ['Accepted'],
  Accepted: ['CollateralPending'],
  CollateralPending: ['Active', 'Refunded'],
  Active: ['RepaymentPending', 'Defaulted'],
  RepaymentPending: ['Repaid', 'Active'],
  Repaid: ['Closed'],
  Defaulted: ['Closed'],
  Refunded: ['Closed'],
  Closed: [],
}

export function canTransition(from: LoanState, to: LoanState): boolean {
  return allowedTransitions[from].includes(to)
}

export function transitionLoan(from: LoanState, to: LoanState): LoanState {
  if (!canTransition(from, to)) throw new Error(`Invalid loan transition: ${from} → ${to}`)
  return to
}
