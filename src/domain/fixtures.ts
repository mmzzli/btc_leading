import type { LoanTerms } from './loanTerms'

export const ALICE_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
export const BOB_PUBKEY = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'

export const exampleLoanTerms: LoanTerms = {
  version: 1,
  network: 'bitcoin-testnet4',
  assetProtocol: 'runes',
  runeId: '840000:1',
  collateralAmount: '1000',
  principalSats: 10_000,
  interestSats: 500,
  loanTermBlocks: 10,
  fundingTimeoutBlocks: 6,
  borrowerAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  borrowerPubkey: ALICE_PUBKEY,
  lenderAddress: 'tb1qq6hag67dl53wl99vzg42z8eyzfz2xlkvvlryfj',
  lenderPubkey: BOB_PUBKEY,
}
