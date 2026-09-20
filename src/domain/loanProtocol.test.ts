import { describe, expect, it } from 'vitest'
import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs'
import { bytesToHex, hexToBytes } from './encoding'
import { buildActivationDraft, buildDefaultClaim, buildRepaymentDraft, finalizeCooperativeRepayment, validateActivationDraft, type ActiveLoanRecord, type BorrowerAcceptance } from './loanProtocol'
import { offerId, type Brc20OfferTerms } from './brc20Offer'
import { ALICE_PUBKEY, BOB_PUBKEY } from './fixtures'

const aliceAddress = bitcoin.payments.p2wpkh({ pubkey: hexToBytes(ALICE_PUBKEY), network: bitcoin.networks.testnet }).address!
const bobAddress = bitcoin.payments.p2wpkh({ pubkey: hexToBytes(BOB_PUBKEY), network: bitcoin.networks.testnet }).address!
const aliceScript = bytesToHex(bitcoin.address.toOutputScript(aliceAddress, bitcoin.networks.testnet))
const bobScript = bytesToHex(bitcoin.address.toOutputScript(bobAddress, bitcoin.networks.testnet))
const alicePrivate = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0)
const bobPrivate = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 2 : 0)
const aliceSigner = { publicKey: hexToBytes(ALICE_PUBKEY), sign: (hash: Uint8Array) => ecc.sign(hash, alicePrivate), signSchnorr: (hash: Uint8Array) => ecc.signSchnorr(hash, alicePrivate) }
const bobSigner = { publicKey: hexToBytes(BOB_PUBKEY), sign: (hash: Uint8Array) => ecc.sign(hash, bobPrivate), signSchnorr: (hash: Uint8Array) => ecc.signSchnorr(hash, bobPrivate) }

const terms: Brc20OfferTerms = {
  version: 1,
  network: 'bitcoin-testnet4',
  collateralProtocol: 'brc-20',
  ticker: 'ORDI',
  collateralAmount: '100',
  principalSats: 10_000,
  interestSats: 500,
  termBlocks: 10,
  lenderAddress: bobAddress,
  lenderPubkey: BOB_PUBKEY,
  createdAt: '2026-09-20T00:00:00.000Z',
  expiresAt: '2099-09-21T00:00:00.000Z',
  nonce: '00112233445566778899aabbccddeeff',
}

const acceptance: BorrowerAcceptance = {
  version: 1,
  offerId: offerId(terms),
  terms,
  borrowerAddress: aliceAddress,
  borrowerPubkey: ALICE_PUBKEY,
  transferInscriptionId: `${'11'.repeat(32)}i0`,
  transferUtxo: { txid: '11'.repeat(32), vout: 0, satoshi: 546, scriptPk: aliceScript },
  feeUtxo: { txid: '22'.repeat(32), vout: 1, satoshi: 20_000, scriptPk: aliceScript },
  feeRate: 1,
  acceptedAt: '2026-09-20T01:00:00.000Z',
}

describe('BRC-20 loan transaction protocol', () => {
  it('builds an atomic activation plus dependent vault Transfer chain', () => {
    const draft = buildActivationDraft({
      acceptance,
      lenderUtxos: [{ txid: '33'.repeat(32), vout: 0, satoshi: 30_000, scriptPk: bobScript }],
    })
    expect(draft.activationTxid).toMatch(/^[0-9a-f]{64}$/)
    expect(draft.commitTxid).toMatch(/^[0-9a-f]{64}$/)
    expect(draft.collateralOutpoint).toBe(`${draft.revealTxid}:0`)
    expect(draft.borrowerActivationInputs.map((item) => item.index)).toEqual([0, 1])
    expect(draft.lenderActivationInputs.map((item) => item.index)).toEqual([2])
    expect(draft.fees.total).toBeGreaterThan(0)

    const activation = bitcoin.Psbt.fromHex(draft.activationPsbt, { network: bitcoin.networks.testnet })
    expect(activation.txOutputs[0].address).toBe(draft.vault.address)
    expect(Number(activation.txOutputs[1].value)).toBe(terms.principalSats)
    const reveal = bitcoin.Psbt.fromHex(draft.revealPsbt, { network: bitcoin.networks.testnet })
    expect(reveal.txOutputs[0].address).toBe(draft.vault.address)
    expect(Number(reveal.txOutputs[0].value)).toBe(546)

    activation.signInput(0, aliceSigner)
    activation.signInput(1, aliceSigner)
    activation.signInput(2, bobSigner)
    activation.finalizeAllInputs()
    expect(activation.extractTransaction().getId()).toBe(draft.activationTxid)
    const commit = bitcoin.Psbt.fromHex(draft.commitPsbt, { network: bitcoin.networks.testnet })
    commit.signInput(0, aliceSigner)
    commit.finalizeAllInputs()
    expect(commit.extractTransaction().getId()).toBe(draft.commitTxid)
    reveal.signInput(0, aliceSigner)
    reveal.finalizeAllInputs()
    expect(reveal.extractTransaction().getId()).toBe(draft.revealTxid)
  })

  it('binds repayment and collateral return in the same PSBT', () => {
    const draft = buildActivationDraft({ acceptance, lenderUtxos: [{ txid: '33'.repeat(32), vout: 0, satoshi: 30_000, scriptPk: bobScript }] })
    const record: ActiveLoanRecord = {
      version: 1,
      kind: 'brc20-active-loan',
      offerId: acceptance.offerId,
      terms,
      borrowerAddress: aliceAddress,
      borrowerPubkey: ALICE_PUBKEY,
      vault: draft.vault,
      collateralTxid: draft.revealTxid,
      collateralVout: 0,
      collateralSats: 546,
      activationTxid: draft.activationTxid,
      commitTxid: draft.commitTxid,
      activatedAt: acceptance.acceptedAt,
    }
    const repayment = buildRepaymentDraft(record, [{ txid: '44'.repeat(32), vout: 0, satoshi: 20_000, scriptPk: aliceScript }], 1)
    const psbt = bitcoin.Psbt.fromHex(repayment.psbt, { network: bitcoin.networks.testnet })
    expect(psbt.txOutputs[0].address).toBe(aliceAddress)
    expect(Number(psbt.txOutputs[0].value)).toBe(546)
    expect(psbt.txOutputs[1].address).toBe(bobAddress)
    expect(Number(psbt.txOutputs[1].value)).toBe(10_500)
    expect(repayment.borrowerInputs[0].index).toBe(0)
    expect(repayment.lenderInputs[0].index).toBe(0)

    const signed = bitcoin.Psbt.fromHex(repayment.psbt, { network: bitcoin.networks.testnet })
    signed.signInput(0, aliceSigner)
    signed.signInput(1, aliceSigner)
    signed.signInput(0, bobSigner)
    const finalized = finalizeCooperativeRepayment(signed.toHex(), record)
    expect(bitcoin.Psbt.fromHex(finalized, { network: bitcoin.networks.testnet }).extractTransaction().toHex()).toMatch(/^02/)
  })

  it('builds the lender timeout claim with the agreed CSV sequence', () => {
    const draft = buildActivationDraft({ acceptance, lenderUtxos: [{ txid: '33'.repeat(32), vout: 0, satoshi: 30_000, scriptPk: bobScript }] })
    const record: ActiveLoanRecord = {
      version: 1, kind: 'brc20-active-loan', offerId: acceptance.offerId, terms,
      borrowerAddress: aliceAddress, borrowerPubkey: ALICE_PUBKEY, vault: draft.vault,
      collateralTxid: draft.revealTxid, collateralVout: 0, collateralSats: 546,
      activationTxid: draft.activationTxid, commitTxid: draft.commitTxid, activatedAt: acceptance.acceptedAt,
    }
    const claim = buildDefaultClaim(record, [{ txid: '55'.repeat(32), vout: 0, satoshi: 5_000, scriptPk: bobScript }], 1)
    const psbt = bitcoin.Psbt.fromHex(claim.psbt, { network: bitcoin.networks.testnet })
    expect(psbt.txInputs[0].sequence).toBe(terms.termBlocks)
    expect(psbt.txOutputs[0].address).toBe(bobAddress)
    psbt.signInput(0, bobSigner)
    psbt.signInput(1, bobSigner)
    psbt.finalizeAllInputs()
    expect(psbt.extractTransaction().toHex()).toMatch(/^02/)
  })

  it('refuses an activation draft whose agreed amount was changed', () => {
    const draft = buildActivationDraft({ acceptance, lenderUtxos: [{ txid: '33'.repeat(32), vout: 0, satoshi: 30_000, scriptPk: bobScript }] })
    const tampered = structuredClone(draft)
    tampered.terms.principalSats += 1
    expect(() => validateActivationDraft(tampered)).toThrow(/不一致/)
  })

  it('refuses an active record whose Taproot vault was changed', () => {
    const draft = buildActivationDraft({ acceptance, lenderUtxos: [{ txid: '33'.repeat(32), vout: 0, satoshi: 30_000, scriptPk: bobScript }] })
    const record: ActiveLoanRecord = {
      version: 1, kind: 'brc20-active-loan', offerId: acceptance.offerId, terms,
      borrowerAddress: aliceAddress, borrowerPubkey: ALICE_PUBKEY, vault: structuredClone(draft.vault),
      collateralTxid: draft.revealTxid, collateralVout: 0, collateralSats: 546,
      activationTxid: draft.activationTxid, commitTxid: draft.commitTxid, activatedAt: acceptance.acceptedAt,
    }
    record.vault.address = bobAddress
    expect(() => buildDefaultClaim(record, [{ txid: '55'.repeat(32), vout: 0, satoshi: 5_000, scriptPk: bobScript }], 1)).toThrow(/金库已被修改/)
  })
})
