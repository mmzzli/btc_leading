import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs'
import { bytesToHex, hexToBytes, toXOnly } from './encoding'

bitcoin.initEccLib(ecc)

export const TAPROOT_NUMS_KEY = hexToBytes(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
)

export interface VaultDefinition {
  address: string
  outputScriptHex: string
  cooperativeScriptHex: string
  timeoutScriptHex: string
}

interface VaultInput {
  borrowerPubkey: string
  lenderPubkey: string
  relativeBlocks: number
}

function assertRelativeBlocks(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('Relative block lock must be between 1 and 65,535')
  }
}

export function buildCooperativeScript(borrowerPubkey: string, lenderPubkey: string): Uint8Array {
  const borrower = toXOnly(hexToBytes(borrowerPubkey))
  const lender = toXOnly(hexToBytes(lenderPubkey))
  return bitcoin.script.compile([
    borrower,
    bitcoin.opcodes.OP_CHECKSIG,
    lender,
    bitcoin.opcodes.OP_CHECKSIGADD,
    bitcoin.opcodes.OP_2,
    bitcoin.opcodes.OP_NUMEQUAL,
  ])
}

export function buildCsvScript(relativeBlocks: number, pubkey: string): Uint8Array {
  assertRelativeBlocks(relativeBlocks)
  return bitcoin.script.compile([
    bitcoin.script.number.encode(relativeBlocks),
    bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY,
    bitcoin.opcodes.OP_DROP,
    toXOnly(hexToBytes(pubkey)),
    bitcoin.opcodes.OP_CHECKSIG,
  ])
}

function buildVault(input: VaultInput, timeoutOwner: 'borrower' | 'lender'): VaultDefinition {
  const cooperativeScript = buildCooperativeScript(input.borrowerPubkey, input.lenderPubkey)
  const timeoutPubkey = timeoutOwner === 'borrower' ? input.borrowerPubkey : input.lenderPubkey
  const timeoutScript = buildCsvScript(input.relativeBlocks, timeoutPubkey)
  const payment = bitcoin.payments.p2tr({
    internalPubkey: TAPROOT_NUMS_KEY,
    scriptTree: [{ output: cooperativeScript }, { output: timeoutScript }],
    network: bitcoin.networks.testnet,
  })

  if (!payment.address || !payment.output) throw new Error('Unable to construct Taproot vault')
  return {
    address: payment.address,
    outputScriptHex: bytesToHex(payment.output),
    cooperativeScriptHex: bytesToHex(cooperativeScript),
    timeoutScriptHex: bytesToHex(timeoutScript),
  }
}

export function buildPendingVault(input: VaultInput): VaultDefinition {
  return buildVault(input, 'borrower')
}

export function buildActiveVault(input: VaultInput): VaultDefinition {
  return buildVault(input, 'lender')
}
