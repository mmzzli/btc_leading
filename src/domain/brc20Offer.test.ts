import { describe, expect, it } from 'vitest'
import { canonicalizeOffer, offerId, parseSignedOffer, type Brc20OfferTerms, validateOfferTerms } from './brc20Offer'

const terms: Brc20OfferTerms = {
  version: 1,
  network: 'bitcoin-testnet4',
  collateralProtocol: 'brc-20',
  ticker: 'ordi',
  collateralAmount: '100',
  principalSats: 10_000,
  interestSats: 500,
  termBlocks: 10,
  lenderAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  lenderPubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  createdAt: '2026-09-19T00:00:00.000Z',
  expiresAt: '2026-09-20T00:00:00.000Z',
  nonce: '00112233445566778899aabbccddeeff',
}

describe('BRC-20 signed offer', () => {
  it('has stable canonical content and id', () => {
    expect(canonicalizeOffer(terms)).toContain('"collateralProtocol":"brc-20"')
    expect(offerId(terms)).toBe('brc20_c5852fd35a9bd3551a6802f7')
  })

  it('changes id when an economic term changes', () => {
    expect(offerId({ ...terms, interestSats: 501 })).not.toBe(offerId(terms))
  })

  it('validates a future offer and rejects an expired one', () => {
    expect(validateOfferTerms(terms, new Date('2026-09-19T12:00:00.000Z'))).toEqual([])
    expect(validateOfferTerms(terms, new Date('2026-09-21T00:00:00.000Z'))).toContain('报价已经过期')
  })

  it('detects modified signed content', () => {
    const payload = JSON.stringify({ offerId: offerId(terms), terms: { ...terms, principalSats: 20_000 }, signature: 'test', signatureProtocol: 'bip322-simple' })
    expect(() => parseSignedOffer(payload, new Date('2026-09-19T12:00:00.000Z'))).toThrow('可能被修改')
  })
})
