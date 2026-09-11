import { describe, expect, it } from 'vitest'
import { ALICE_PUBKEY, BOB_PUBKEY } from './fixtures'
import { buildActiveVault, buildPendingVault } from './vaults'
import { canSpendVault } from './vaultPolicy'

const keys = { borrowerPubkey: ALICE_PUBKEY, lenderPubkey: BOB_PUBKEY }

describe('Taproot loan vault vectors', () => {
  it('builds the frozen pending vault vector', () => {
    const vault = buildPendingVault({ ...keys, relativeBlocks: 6 })
    expect(vault.address).toBe('tb1p0mxxmvmryn8jgm4swa3ryylpclas6w9cmyqy8fzq49pgs2ryzpwsfjd5c3')
    expect(vault.outputScriptHex).toBe('51207ecc6db36324cf246eb077623213e1c7fb0d38b8d90043a440a942882864105d')
    expect(vault.timeoutScriptHex).toBe(
      '56b2752079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac',
    )
  })

  it('builds the frozen active vault vector', () => {
    const vault = buildActiveVault({ ...keys, relativeBlocks: 10 })
    expect(vault.address).toBe('tb1pc40pldh5x7d2v3x9pecfxpaedmnzrxj807dsg4wr7lz25ayay6eq23pw6a')
    expect(vault.outputScriptHex).toBe('5120c55e1fb6f4379aa644c50e709307b96ee6219a477f9b0455c3f7c4aa749d26b2')
    expect(vault.timeoutScriptHex).toBe(
      '5ab27520c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac',
    )
  })

  it('changes addresses when a key or timeout changes', () => {
    const original = buildPendingVault({ ...keys, relativeBlocks: 6 })
    const changedTimeout = buildPendingVault({ ...keys, relativeBlocks: 7 })
    const changedKeys = buildPendingVault({
      borrowerPubkey: BOB_PUBKEY,
      lenderPubkey: ALICE_PUBKEY,
      relativeBlocks: 6,
    })
    expect(changedTimeout.address).not.toBe(original.address)
    expect(changedKeys.address).not.toBe(original.address)
  })
})

describe('vault exit policy', () => {
  it('requires both signatures on cooperative exits', () => {
    expect(canSpendVault({ kind: 'pending', path: 'cooperative', sequence: 0, relativeBlocks: 6, borrowerSigned: true, lenderSigned: true })).toBe(true)
    expect(canSpendVault({ kind: 'pending', path: 'cooperative', sequence: 0, relativeBlocks: 6, borrowerSigned: true, lenderSigned: false })).toBe(false)
  })

  it('allows only Alice to refund pending collateral after timeout', () => {
    expect(canSpendVault({ kind: 'pending', path: 'timeout', sequence: 5, relativeBlocks: 6, borrowerSigned: true, lenderSigned: false })).toBe(false)
    expect(canSpendVault({ kind: 'pending', path: 'timeout', sequence: 6, relativeBlocks: 6, borrowerSigned: true, lenderSigned: false })).toBe(true)
    expect(canSpendVault({ kind: 'pending', path: 'timeout', sequence: 6, relativeBlocks: 6, borrowerSigned: false, lenderSigned: true })).toBe(false)
  })

  it('allows only Bob to claim active collateral after maturity', () => {
    expect(canSpendVault({ kind: 'active', path: 'timeout', sequence: 9, relativeBlocks: 10, borrowerSigned: false, lenderSigned: true })).toBe(false)
    expect(canSpendVault({ kind: 'active', path: 'timeout', sequence: 10, relativeBlocks: 10, borrowerSigned: false, lenderSigned: true })).toBe(true)
    expect(canSpendVault({ kind: 'active', path: 'timeout', sequence: 10, relativeBlocks: 10, borrowerSigned: true, lenderSigned: false })).toBe(false)
  })
})
