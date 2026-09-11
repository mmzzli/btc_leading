import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs'
import { bytesToHex, hexToBytes } from './encoding'

export const LOAN_NETWORK = 'bitcoin-testnet4' as const
export const ASSET_PROTOCOL = 'runes' as const

export interface LoanTerms {
  version: 1
  network: typeof LOAN_NETWORK
  assetProtocol: typeof ASSET_PROTOCOL
  runeId: string
  collateralAmount: string
  principalSats: number
  interestSats: number
  loanTermBlocks: number
  fundingTimeoutBlocks: number
  borrowerAddress: string
  borrowerPubkey: string
  lenderAddress: string
  lenderPubkey: string
}

const orderedKeys: Array<keyof LoanTerms> = [
  'version',
  'network',
  'assetProtocol',
  'runeId',
  'collateralAmount',
  'principalSats',
  'interestSats',
  'loanTermBlocks',
  'fundingTimeoutBlocks',
  'borrowerAddress',
  'borrowerPubkey',
  'lenderAddress',
  'lenderPubkey',
]

export function canonicalizeLoanTerms(terms: LoanTerms): string {
  const ordered = Object.fromEntries(orderedKeys.map((key) => [key, terms[key]]))
  return JSON.stringify(ordered)
}

export function hashLoanTerms(terms: LoanTerms): string {
  const encoded = new TextEncoder().encode(canonicalizeLoanTerms(terms))
  return bytesToHex(bitcoin.crypto.sha256(encoded))
}

export function loanIdFromTerms(terms: LoanTerms): string {
  return `loan_${hashLoanTerms(terms).slice(0, 24)}`
}

function isCompressedPubkey(value: string): boolean {
  if (!/^(02|03)[0-9a-f]{64}$/.test(value)) return false
  return ecc.isPoint(hexToBytes(value))
}

function isTestnetAddress(value: string): boolean {
  try {
    bitcoin.address.toOutputScript(value, bitcoin.networks.testnet)
    return /^(tb1q|tb1p)/.test(value)
  } catch {
    return false
  }
}

export function validateLoanTerms(terms: LoanTerms): string[] {
  const errors: string[] = []
  if (terms.version !== 1) errors.push('只支持条款版本 1')
  if (terms.network !== LOAN_NETWORK) errors.push('网络必须是 Bitcoin Testnet4')
  if (terms.assetProtocol !== ASSET_PROTOCOL) errors.push('第一版只支持 Runes')
  if (!/^[1-9][0-9]*:[0-9]+$/.test(terms.runeId)) errors.push('Rune ID 应为“区块高度:交易序号”')
  if (!/^[1-9][0-9]*$/.test(terms.collateralAmount)) errors.push('抵押数量必须是正整数')
  if (!Number.isSafeInteger(terms.principalSats) || terms.principalSats < 546) errors.push('本金至少为 546 sats')
  if (!Number.isSafeInteger(terms.interestSats) || terms.interestSats < 0) errors.push('利息不能为负数')
  if (!Number.isInteger(terms.loanTermBlocks) || terms.loanTermBlocks < 1 || terms.loanTermBlocks > 65_535) errors.push('贷款期限必须是 1–65,535 个区块')
  if (!Number.isInteger(terms.fundingTimeoutBlocks) || terms.fundingTimeoutBlocks < 1 || terms.fundingTimeoutBlocks > 65_535) errors.push('放款等待期必须是 1–65,535 个区块')
  if (!isTestnetAddress(terms.borrowerAddress)) errors.push('借款人地址不是受支持的 Testnet4 地址')
  if (!isTestnetAddress(terms.lenderAddress)) errors.push('出借人地址不是受支持的 Testnet4 地址')
  if (!isCompressedPubkey(terms.borrowerPubkey)) errors.push('借款人公钥无效')
  if (!isCompressedPubkey(terms.lenderPubkey)) errors.push('出借人公钥无效')
  if (terms.borrowerPubkey === terms.lenderPubkey) errors.push('借款人与出借人不能使用同一个公钥')
  return errors
}
