import * as bitcoin from 'bitcoinjs-lib'
import { bytesToHex, hexToBytes, toXOnly } from './encoding'
import { TAPROOT_NUMS_KEY, buildActiveVault, type SpendableVaultDefinition } from './vaults'
import type { Brc20OfferTerms } from './brc20Offer'
import { offerId, validateOfferTerms } from './brc20Offer'
import type { ChainUtxo } from '../services/brc20Api'

const TAPLEAF_VERSION = 0xc0
const INSCRIPTION_SATS = 546
const DUST = 546

export interface WalletSignInput {
  index: number
  publicKey: string
  useTweakedSigner: boolean
}

export interface BorrowerAcceptance {
  version: 1
  offerId: string
  terms: Brc20OfferTerms
  borrowerAddress: string
  borrowerPubkey: string
  transferInscriptionId: string
  transferUtxo: ChainUtxo
  feeUtxo: ChainUtxo
  feeRate: number
  acceptedAt: string
}

export interface ActivationDraft {
  version: 1
  kind: 'brc20-loan-activation'
  offerId: string
  terms: Brc20OfferTerms
  borrowerAddress: string
  borrowerPubkey: string
  acceptance: BorrowerAcceptance
  lenderUtxos: ChainUtxo[]
  vault: SpendableVaultDefinition
  activationPsbt: string
  commitPsbt: string
  revealPsbt: string
  borrowerActivationInputs: WalletSignInput[]
  lenderActivationInputs: WalletSignInput[]
  borrowerCommitInputs: WalletSignInput[]
  borrowerRevealInputs: WalletSignInput[]
  activationTxid: string
  commitTxid: string
  revealTxid: string
  collateralOutpoint: string
  fees: { activation: number; commit: number; reveal: number; total: number }
}

export interface ActiveLoanRecord {
  version: 1
  kind: 'brc20-active-loan'
  offerId: string
  terms: Brc20OfferTerms
  borrowerAddress: string
  borrowerPubkey: string
  vault: SpendableVaultDefinition
  collateralTxid: string
  collateralVout: number
  collateralSats: number
  activationTxid: string
  commitTxid: string
  activatedAt: string
}

export interface BorrowerSignedActivation {
  kind: 'borrower-signed-activation'
  draft: ActivationDraft
  activationPsbt: string
  commitPsbt: string
  revealPsbt: string
}

export interface BorrowerSignedRepayment {
  kind: 'borrower-signed-repayment'
  record: ActiveLoanRecord
  psbt: string
  lenderInputs: WalletSignInput[]
  repay: number
  fee: number
}

type Output = { script: Uint8Array; value: number }

function addressScript(address: string): Uint8Array {
  return bitcoin.address.toOutputScript(address, bitcoin.networks.testnet)
}

function cleanPubkey(value: string): Uint8Array {
  const key = hexToBytes(value)
  if (key.length !== 33) throw new Error('需要 33 字节压缩公钥')
  return key
}

function addUtxo(psbt: bitcoin.Psbt, utxo: ChainUtxo, sequence?: number) {
  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    sequence,
    witnessUtxo: { script: hexToBytes(utxo.scriptPk), value: BigInt(utxo.satoshi) },
  })
}

function addOutputs(psbt: bitcoin.Psbt, outputs: Output[]) {
  outputs.forEach((output) => psbt.addOutput({ script: output.script, value: BigInt(output.value) }))
}

function walletWitness(scriptPk: string): Uint8Array[] {
  const script = hexToBytes(scriptPk)
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) return [new Uint8Array(64)]
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return [new Uint8Array(73), new Uint8Array(33)]
  throw new Error('只支持 UniSat 的 Native SegWit 或 Taproot 地址')
}

function estimateFee(inputs: Array<{ kind: 'wallet'; utxo: ChainUtxo } | { kind: 'script'; witness: Uint8Array[] }>, outputs: Output[], feeRate: number): number {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  inputs.forEach((input, index) => {
    tx.addInput(new Uint8Array(32), index)
    tx.setWitness(index, input.kind === 'wallet' ? walletWitness(input.utxo.scriptPk) : input.witness)
  })
  outputs.forEach((output) => tx.addOutput(output.script, BigInt(output.value)))
  return Math.ceil(tx.virtualSize() * Math.max(1, feeRate))
}

function unsignedTxid(psbt: bitcoin.Psbt): string {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  psbt.txInputs.forEach((input) => tx.addInput(input.hash, input.index, input.sequence))
  psbt.txOutputs.forEach((output) => tx.addOutput(output.script, output.value))
  return tx.getId()
}

function keySignInput(index: number, pubkey: string, scriptPk: string): WalletSignInput {
  const script = hexToBytes(scriptPk)
  return { index, publicKey: pubkey, useTweakedSigner: script.length === 34 && script[0] === 0x51 && script[1] === 0x20 }
}

function makeInscriptionPayment(pubkey: string, ticker: string, amount: string) {
  const content = JSON.stringify({ p: 'brc-20', op: 'transfer', tick: ticker.toLowerCase(), amt: amount })
  const script = bitcoin.script.compile([
    toXOnly(cleanPubkey(pubkey)), bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_FALSE, bitcoin.opcodes.OP_IF,
    new TextEncoder().encode('ord'), 1, 1,
    new TextEncoder().encode('text/plain;charset=utf-8'),
    new Uint8Array(0), new TextEncoder().encode(content), bitcoin.opcodes.OP_ENDIF,
  ])
  const redeem = { output: script, redeemVersion: TAPLEAF_VERSION }
  const payment = bitcoin.payments.p2tr({
    internalPubkey: TAPROOT_NUMS_KEY,
    scriptTree: { output: script, version: TAPLEAF_VERSION },
    redeem,
    network: bitcoin.networks.testnet,
  })
  if (!payment.output || !payment.witness?.length) throw new Error('无法生成 BRC-20 Reveal 脚本')
  return {
    output: payment.output,
    script,
    controlBlock: payment.witness[payment.witness.length - 1],
  }
}

function validateUtxo(utxo: ChainUtxo, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(utxo.txid) || !Number.isInteger(utxo.vout) || utxo.vout < 0 || utxo.satoshi <= 0 || !utxo.scriptPk) {
    throw new Error(`${label} UTXO 无效`)
  }
}

function assertOwnedUtxo(utxo: ChainUtxo, address: string, label: string) {
  const expected = bytesToHex(addressScript(address))
  if (utxo.scriptPk.toLowerCase() !== expected) throw new Error(`${label}不属于约定的钱包地址`)
}

export function buildActivationDraft(params: {
  acceptance: BorrowerAcceptance
  lenderUtxos: ChainUtxo[]
}): ActivationDraft {
  const { acceptance } = params
  const terms = acceptance.terms
  const termErrors = validateOfferTerms(terms)
  if (termErrors.length) throw new Error(termErrors.join('；'))
  if (acceptance.offerId !== offerId(terms)) throw new Error('接受申请中的报价编号与条款不一致')
  if (!/^tb1[qp][a-z0-9]{38,}$/.test(acceptance.borrowerAddress)) throw new Error('Alice 地址不是 Testnet4 SegWit/Taproot 地址')
  validateUtxo(acceptance.transferUtxo, 'Transfer')
  validateUtxo(acceptance.feeUtxo, 'Alice 手续费')
  assertOwnedUtxo(acceptance.transferUtxo, acceptance.borrowerAddress, 'Transfer UTXO')
  assertOwnedUtxo(acceptance.feeUtxo, acceptance.borrowerAddress, 'Alice 手续费 UTXO')
  if (`${acceptance.transferUtxo.txid}:${acceptance.transferUtxo.vout}` === `${acceptance.feeUtxo.txid}:${acceptance.feeUtxo.vout}`) throw new Error('Transfer 和手续费不能使用同一个 UTXO')
  if (terms.lenderPubkey.length !== 66 || acceptance.borrowerPubkey.length !== 66) throw new Error('双方公钥无效')

  const vault = buildActiveVault({ borrowerPubkey: acceptance.borrowerPubkey, lenderPubkey: terms.lenderPubkey, relativeBlocks: terms.termBlocks })
  const vaultOutput = hexToBytes(vault.outputScriptHex)
  const borrowerScript = addressScript(acceptance.borrowerAddress)
  const lenderScript = addressScript(terms.lenderAddress)
  const inscription = makeInscriptionPayment(acceptance.borrowerPubkey, terms.ticker, terms.collateralAmount)

  const revealOutputs: Output[] = [{ script: vaultOutput, value: INSCRIPTION_SATS }]
  const revealFee = estimateFee([{ kind: 'script', witness: [new Uint8Array(64), inscription.script, inscription.controlBlock] }], revealOutputs, acceptance.feeRate)
  const commitValue = INSCRIPTION_SATS + revealFee
  const commitOutputs: Output[] = [{ script: inscription.output, value: commitValue }]
  const commitFee = estimateFee([{ kind: 'wallet', utxo: acceptance.feeUtxo }], commitOutputs, acceptance.feeRate)
  const chainFunding = commitValue + commitFee
  if (acceptance.feeUtxo.satoshi < chainFunding) throw new Error(`Alice 需要至少一个 ${chainFunding} sats 的可用 BTC UTXO 来准备金库退出凭证`)
  const aliceActivationChange = acceptance.feeUtxo.satoshi - chainFunding
  const includeAliceChange = aliceActivationChange >= DUST

  const lenderCandidates = params.lenderUtxos.filter((utxo) => !utxo.isSpent).sort((a, b) => b.satoshi - a.satoshi)
  const selectedLender: ChainUtxo[] = []
  let lenderTotal = 0
  let activationFee = 0
  let lenderChange = 0
  let activationOutputs: Output[] = []
  for (const utxo of lenderCandidates) {
    validateUtxo(utxo, 'Bob 本金')
    assertOwnedUtxo(utxo, terms.lenderAddress, 'Bob 本金 UTXO')
    selectedLender.push(utxo)
    lenderTotal += utxo.satoshi
    const base: Output[] = [
      { script: vaultOutput, value: INSCRIPTION_SATS },
      { script: borrowerScript, value: terms.principalSats },
      { script: borrowerScript, value: chainFunding },
    ]
    if (includeAliceChange) base.push({ script: borrowerScript, value: aliceActivationChange })
    const withBobChange = [...base, { script: lenderScript, value: DUST }]
    activationFee = estimateFee([
      { kind: 'wallet', utxo: acceptance.transferUtxo },
      { kind: 'wallet', utxo: acceptance.feeUtxo },
      ...selectedLender.map((item) => ({ kind: 'wallet' as const, utxo: item })),
    ], withBobChange, acceptance.feeRate)
    lenderChange = lenderTotal - terms.principalSats - activationFee
    if (lenderChange >= DUST) {
      activationOutputs = [...base, { script: lenderScript, value: lenderChange }]
      break
    }
    if (lenderChange >= 0) {
      activationFee += lenderChange
      lenderChange = 0
      activationOutputs = base
      break
    }
  }
  if (!activationOutputs.length) throw new Error('Bob 的可用 BTC UTXO 不足以支付本金和激活手续费')
  activationFee = acceptance.transferUtxo.satoshi + acceptance.feeUtxo.satoshi + lenderTotal
    - activationOutputs.reduce((sum, output) => sum + output.value, 0)

  const activation = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
  activation.setVersion(2)
  addUtxo(activation, acceptance.transferUtxo)
  addUtxo(activation, acceptance.feeUtxo)
  selectedLender.forEach((utxo) => addUtxo(activation, utxo))
  addOutputs(activation, activationOutputs)
  const activationTxid = unsignedTxid(activation)

  const commit = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
  commit.setVersion(2)
  commit.addInput({ hash: activationTxid, index: 2, witnessUtxo: { script: borrowerScript, value: BigInt(chainFunding) } })
  addOutputs(commit, commitOutputs)
  const commitTxid = unsignedTxid(commit)

  const reveal = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
  reveal.setVersion(2)
  reveal.addInput({
    hash: commitTxid,
    index: 0,
    witnessUtxo: { script: inscription.output, value: BigInt(commitValue) },
    tapLeafScript: [{ leafVersion: TAPLEAF_VERSION, script: inscription.script, controlBlock: inscription.controlBlock }],
    tapInternalKey: TAPROOT_NUMS_KEY,
  })
  addOutputs(reveal, revealOutputs)
  const revealTxid = unsignedTxid(reveal)
  const borrowerKey = acceptance.borrowerPubkey.toLowerCase()
  const lenderKey = terms.lenderPubkey.toLowerCase()
  return {
    version: 1,
    kind: 'brc20-loan-activation',
    offerId: acceptance.offerId,
    terms,
    borrowerAddress: acceptance.borrowerAddress,
    borrowerPubkey: borrowerKey,
    acceptance,
    lenderUtxos: selectedLender,
    vault,
    activationPsbt: activation.toHex(),
    commitPsbt: commit.toHex(),
    revealPsbt: reveal.toHex(),
    borrowerActivationInputs: [
      keySignInput(0, borrowerKey, acceptance.transferUtxo.scriptPk),
      keySignInput(1, borrowerKey, acceptance.feeUtxo.scriptPk),
    ],
    lenderActivationInputs: selectedLender.map((utxo, index) => keySignInput(index + 2, lenderKey, utxo.scriptPk)),
    borrowerCommitInputs: [keySignInput(0, borrowerKey, bytesToHex(borrowerScript))],
    borrowerRevealInputs: [{ index: 0, publicKey: borrowerKey, useTweakedSigner: false }],
    activationTxid,
    commitTxid,
    revealTxid,
    collateralOutpoint: `${revealTxid}:0`,
    fees: { activation: activationFee, commit: commitFee, reveal: revealFee, total: activationFee + commitFee + revealFee },
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertUnsignedTx(psbtHex: string, expectedTxid: string, label: string) {
  let psbt: bitcoin.Psbt
  try { psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoin.networks.testnet }) } catch { throw new Error(`${label}不是有效的 PSBT`) }
  if (unsignedTxid(psbt) !== expectedTxid) throw new Error(`${label}的输入或输出已被修改`)
}

export function validateActivationDraft(draft: ActivationDraft): void {
  if (draft.version !== 1 || draft.kind !== 'brc20-loan-activation' || !draft.acceptance || !Array.isArray(draft.lenderUtxos)) throw new Error('放款草稿格式不正确')
  const rebuilt = buildActivationDraft({ acceptance: draft.acceptance, lenderUtxos: draft.lenderUtxos })
  if (!sameJson(rebuilt, draft)) throw new Error('放款草稿与双方约定不一致，不能签名')
}

export function validateBorrowerSignedActivation(signed: BorrowerSignedActivation): void {
  if (signed.kind !== 'borrower-signed-activation') throw new Error('这不是 Alice 已签放款包')
  validateActivationDraft(signed.draft)
  assertUnsignedTx(signed.activationPsbt, signed.draft.activationTxid, '已签激活交易')
  assertUnsignedTx(signed.commitPsbt, signed.draft.commitTxid, '已签 Commit 交易')
  assertUnsignedTx(signed.revealPsbt, signed.draft.revealTxid, '已签 Reveal 交易')
}

function assertActiveRecord(record: ActiveLoanRecord) {
  if (record.version !== 1 || record.kind !== 'brc20-active-loan') throw new Error('活动贷款记录格式不正确')
  if (record.offerId !== offerId(record.terms)) throw new Error('活动贷款记录的报价编号不一致')
  const termErrors = validateOfferTerms(record.terms, new Date(record.terms.createdAt))
  if (termErrors.length) throw new Error(termErrors.join('；'))
  if (!/^[0-9a-f]{64}$/i.test(record.collateralTxid) || record.collateralVout !== 0 || record.collateralSats !== INSCRIPTION_SATS) throw new Error('活动贷款记录的抵押输出无效')
  const expectedVault = buildActiveVault({ borrowerPubkey: record.borrowerPubkey, lenderPubkey: record.terms.lenderPubkey, relativeBlocks: record.terms.termBlocks })
  if (!sameJson(expectedVault, record.vault)) throw new Error('活动贷款记录的 Taproot 金库已被修改')
}

function tapLeafInput(txid: string, vout: number, sats: number, vault: SpendableVaultDefinition, path: 'cooperativePath' | 'timeoutPath', sequence?: number) {
  const leaf = vault[path]
  return {
    hash: txid,
    index: vout,
    sequence,
    witnessUtxo: { script: hexToBytes(vault.outputScriptHex), value: BigInt(sats) },
    tapLeafScript: [{ leafVersion: leaf.leafVersion, script: hexToBytes(leaf.scriptHex), controlBlock: hexToBytes(leaf.controlBlockHex) }],
    tapInternalKey: TAPROOT_NUMS_KEY,
  }
}

export function buildRepaymentDraft(record: ActiveLoanRecord, borrowerUtxos: ChainUtxo[], feeRate: number) {
  assertActiveRecord(record)
  const repay = record.terms.principalSats + record.terms.interestSats
  const selected: ChainUtxo[] = []
  let total = 0
  let fee = 0
  let change = 0
  const collateralOutput: Output = { script: addressScript(record.borrowerAddress), value: record.collateralSats }
  const repayOutput: Output = { script: addressScript(record.terms.lenderAddress), value: repay }
  let outputs: Output[] = []
  const coop = record.vault.cooperativePath
  for (const utxo of borrowerUtxos.filter((item) => !item.isSpent).sort((a, b) => b.satoshi - a.satoshi)) {
    assertOwnedUtxo(utxo, record.borrowerAddress, 'Alice 还款 UTXO')
    selected.push(utxo)
    total += utxo.satoshi
    const base = [collateralOutput, repayOutput]
    fee = estimateFee([
      { kind: 'script', witness: [new Uint8Array(64), new Uint8Array(64), hexToBytes(coop.scriptHex), hexToBytes(coop.controlBlockHex)] },
      ...selected.map((item) => ({ kind: 'wallet' as const, utxo: item })),
    ], [...base, { script: addressScript(record.borrowerAddress), value: DUST }], feeRate)
    change = total - repay - fee
    if (change >= DUST) { outputs = [...base, { script: addressScript(record.borrowerAddress), value: change }]; break }
    if (change >= 0) { fee += change; change = 0; outputs = base; break }
  }
  if (!outputs.length) throw new Error('Alice 的 BTC 不足以偿还本金、利息和矿工费')
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
  psbt.setVersion(2)
  psbt.addInput(tapLeafInput(record.collateralTxid, record.collateralVout, record.collateralSats, record.vault, 'cooperativePath'))
  selected.forEach((utxo) => addUtxo(psbt, utxo))
  addOutputs(psbt, outputs)
  return {
    psbt: psbt.toHex(), fee, repay,
    borrowerInputs: [
      { index: 0, publicKey: record.borrowerPubkey, useTweakedSigner: false },
      ...selected.map((utxo, index) => keySignInput(index + 1, record.borrowerPubkey, utxo.scriptPk)),
    ],
    lenderInputs: [{ index: 0, publicKey: record.terms.lenderPubkey, useTweakedSigner: false }],
  }
}

export function buildDefaultClaim(record: ActiveLoanRecord, lenderUtxos: ChainUtxo[], feeRate: number) {
  assertActiveRecord(record)
  const timeout = record.vault.timeoutPath
  const selected = lenderUtxos.filter((item) => !item.isSpent).sort((a, b) => b.satoshi - a.satoshi)[0]
  if (!selected) throw new Error('Bob 没有可用 BTC UTXO 支付领取手续费')
  assertOwnedUtxo(selected, record.terms.lenderAddress, 'Bob 手续费 UTXO')
  const collateralOutput: Output = { script: addressScript(record.terms.lenderAddress), value: record.collateralSats }
  const changeScript = addressScript(record.terms.lenderAddress)
  let fee = estimateFee([
    { kind: 'script', witness: [new Uint8Array(64), hexToBytes(timeout.scriptHex), hexToBytes(timeout.controlBlockHex)] },
    { kind: 'wallet', utxo: selected },
  ], [collateralOutput, { script: changeScript, value: DUST }], feeRate)
  const change = selected.satoshi - fee
  if (change < DUST) throw new Error('Bob 的手续费 UTXO 太小')
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
  psbt.setVersion(2)
  psbt.addInput(tapLeafInput(record.collateralTxid, record.collateralVout, record.collateralSats, record.vault, 'timeoutPath', record.terms.termBlocks))
  addUtxo(psbt, selected)
  addOutputs(psbt, [collateralOutput, { script: changeScript, value: change }])
  return {
    psbt: psbt.toHex(), fee,
    lenderInputs: [
      { index: 0, publicKey: record.terms.lenderPubkey, useTweakedSigner: false },
      keySignInput(1, record.terms.lenderPubkey, selected.scriptPk),
    ],
  }
}

function compactSize(value: number): Uint8Array {
  if (value < 0xfd) return Uint8Array.of(value)
  if (value <= 0xffff) return Uint8Array.of(0xfd, value & 0xff, value >> 8)
  throw new Error('Witness item is too large')
}

function concatBytes(items: Uint8Array[]): Uint8Array {
  const size = items.reduce((sum, item) => sum + item.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  items.forEach((item) => { result.set(item, offset); offset += item.length })
  return result
}

function serializeWitness(items: Uint8Array[]): Uint8Array {
  return concatBytes([compactSize(items.length), ...items.flatMap((item) => [compactSize(item.length), item])])
}

export function finalizeCooperativeRepayment(psbtHex: string, record: ActiveLoanRecord): string {
  assertActiveRecord(record)
  const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoin.networks.testnet })
  const collateral = psbt.txInputs[0]
  if (bytesToHex(collateral.hash.slice().reverse()) !== record.collateralTxid || collateral.index !== record.collateralVout) throw new Error('还款交易没有使用约定的抵押品')
  const outputs = psbt.txOutputs
  if (outputs.length < 2 || outputs[0].address !== record.borrowerAddress || Number(outputs[0].value) !== record.collateralSats) throw new Error('还款交易没有把抵押品返还 Alice')
  const repay = record.terms.principalSats + record.terms.interestSats
  if (outputs[1].address !== record.terms.lenderAddress || Number(outputs[1].value) !== repay) throw new Error('还款交易没有向 Bob 支付约定本息')
  if (outputs.slice(2).some((output) => output.address !== record.borrowerAddress)) throw new Error('还款交易包含未经约定的额外收款地址')
  const input = psbt.data.inputs[0]
  const signatures = input.tapScriptSig ?? []
  const borrowerKey = bytesToHex(toXOnly(cleanPubkey(record.borrowerPubkey)))
  const lenderKey = bytesToHex(toXOnly(cleanPubkey(record.terms.lenderPubkey)))
  const borrowerSignature = signatures.find((item) => bytesToHex(item.pubkey) === borrowerKey)?.signature
  const lenderSignature = signatures.find((item) => bytesToHex(item.pubkey) === lenderKey)?.signature
  if (!borrowerSignature || !lenderSignature) throw new Error('还款交易缺少 Alice 或 Bob 的金库签名')
  const path = record.vault.cooperativePath
  psbt.finalizeInput(0, () => ({
    finalScriptWitness: serializeWitness([
      lenderSignature,
      borrowerSignature,
      hexToBytes(path.scriptHex),
      hexToBytes(path.controlBlockHex),
    ]),
  }))
  for (let index = 1; index < psbt.data.inputs.length; index += 1) psbt.finalizeInput(index)
  return psbt.toHex()
}

export function activeRecordFromDraft(draft: ActivationDraft): ActiveLoanRecord {
  return {
    version: 1,
    kind: 'brc20-active-loan',
    offerId: draft.offerId,
    terms: draft.terms,
    borrowerAddress: draft.borrowerAddress,
    borrowerPubkey: draft.borrowerPubkey,
    vault: draft.vault,
    collateralTxid: draft.revealTxid,
    collateralVout: 0,
    collateralSats: INSCRIPTION_SATS,
    activationTxid: draft.activationTxid,
    commitTxid: draft.commitTxid,
    activatedAt: new Date().toISOString(),
  }
}
