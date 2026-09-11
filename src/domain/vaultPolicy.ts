export type VaultKind = 'pending' | 'active'
export type VaultPath = 'cooperative' | 'timeout'

export interface SpendAttempt {
  kind: VaultKind
  path: VaultPath
  sequence: number
  relativeBlocks: number
  borrowerSigned: boolean
  lenderSigned: boolean
}

export function canSpendVault(attempt: SpendAttempt): boolean {
  if (attempt.path === 'cooperative') {
    return attempt.borrowerSigned && attempt.lenderSigned
  }

  if (attempt.sequence < attempt.relativeBlocks) return false
  return attempt.kind === 'pending' ? attempt.borrowerSigned : attempt.lenderSigned
}
