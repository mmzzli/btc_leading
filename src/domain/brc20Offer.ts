import * as bitcoin from 'bitcoinjs-lib'
import { bytesToHex } from './encoding'

export interface Brc20OfferTerms {
  version: 1
  network: 'bitcoin-testnet4'
  collateralProtocol: 'brc-20'
  ticker: string
  collateralAmount: string
  principalSats: number
  interestSats: number
  termBlocks: number
  lenderAddress: string
  lenderPubkey: string
  createdAt: string
  expiresAt: string
  nonce: string
}

export interface SignedBrc20Offer {
  offerId: string
  terms: Brc20OfferTerms
  signature: string
  signatureProtocol: 'bip322-simple'
}

const keys: Array<keyof Brc20OfferTerms> = [
  'version', 'network', 'collateralProtocol', 'ticker', 'collateralAmount',
  'principalSats', 'interestSats', 'termBlocks', 'lenderAddress', 'lenderPubkey',
  'createdAt', 'expiresAt', 'nonce',
]

export function canonicalizeOffer(terms: Brc20OfferTerms): string {
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, terms[key]])))
}

export function offerId(terms: Brc20OfferTerms): string {
  const digest = bitcoin.crypto.sha256(new TextEncoder().encode(canonicalizeOffer(terms)))
  return `brc20_${bytesToHex(digest).slice(0, 24)}`
}

export function validateOfferTerms(terms: Brc20OfferTerms, now = new Date()): string[] {
  const errors: string[] = []
  if (terms.version !== 1) errors.push('报价版本不受支持')
  if (terms.network !== 'bitcoin-testnet4') errors.push('报价必须来自 Bitcoin Testnet4')
  if (terms.collateralProtocol !== 'brc-20') errors.push('抵押品必须是 BRC-20')
  if (!/^[a-zA-Z0-9]{4}$/.test(terms.ticker)) errors.push('第一版只支持 4 字符 BRC-20 ticker')
  if (!/^[1-9][0-9]*$/.test(terms.collateralAmount)) errors.push('抵押数量必须是正整数')
  if (!Number.isSafeInteger(terms.principalSats) || terms.principalSats < 546) errors.push('出借本金至少为 546 sats')
  if (!Number.isSafeInteger(terms.interestSats) || terms.interestSats < 0) errors.push('利息不能为负数')
  if (!Number.isInteger(terms.termBlocks) || terms.termBlocks < 1 || terms.termBlocks > 65_535) errors.push('贷款期限必须是 1–65,535 个区块')
  if (!/^tb1[qp][a-z0-9]{38,}$/.test(terms.lenderAddress)) errors.push('出借人地址不是 Testnet4 SegWit/Taproot 地址')
  if (!/^(02|03)[0-9a-f]{64}$/.test(terms.lenderPubkey)) errors.push('出借人公钥无效')
  if (!Number.isFinite(Date.parse(terms.createdAt)) || !Number.isFinite(Date.parse(terms.expiresAt))) errors.push('报价时间无效')
  if (Date.parse(terms.expiresAt) <= now.getTime()) errors.push('报价已经过期')
  if (!/^[0-9a-f]{32}$/.test(terms.nonce)) errors.push('报价随机数无效')
  return errors
}

export function parseSignedOffer(value: string, now = new Date()): SignedBrc20Offer {
  const parsed = JSON.parse(value) as SignedBrc20Offer
  if (!parsed?.terms || typeof parsed.signature !== 'string') throw new Error('这不是完整的签名报价')
  const errors = validateOfferTerms(parsed.terms, now)
  if (errors.length) throw new Error(errors.join('；'))
  if (parsed.offerId !== offerId(parsed.terms)) throw new Error('报价内容与报价编号不一致，可能被修改')
  if (parsed.signatureProtocol !== 'bip322-simple') throw new Error('报价签名格式不受支持')
  if (!parsed.signature) throw new Error('报价缺少 Bob 的钱包签名')
  return parsed
}

export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}
