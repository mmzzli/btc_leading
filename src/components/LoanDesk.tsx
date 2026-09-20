import { useState } from 'react'
import {
  activeRecordFromDraft,
  buildActivationDraft,
  buildDefaultClaim,
  buildRepaymentDraft,
  finalizeCooperativeRepayment,
  validateActivationDraft,
  validateBorrowerSignedActivation,
  type ActiveLoanRecord,
  type ActivationDraft,
  type BorrowerAcceptance,
  type BorrowerSignedActivation,
  type BorrowerSignedRepayment,
  type WalletSignInput,
} from '../domain/loanProtocol'
import { fetchAvailableUtxos, fetchTransferableInscriptions, outpointFromTransfer } from '../services/brc20Api'

type DeskTask = 'bob-build' | 'alice-sign' | 'bob-broadcast' | 'alice-repay' | 'bob-repay' | 'bob-default'

interface Props {
  address: string
  apiKey: string
  manualApiKey: string
  setManualApiKey: (value: string) => void
  signPsbt: (psbt: string, inputs: WalletSignInput[], autoFinalized?: boolean) => Promise<string>
  pushPsbt: (psbt: string) => Promise<string>
}

const tasks: Array<{ id: DeskTask; role: string; title: string; input: string }> = [
  { id: 'bob-build', role: 'Bob', title: '收到 Alice 的接受申请', input: 'Alice 接受申请' },
  { id: 'alice-sign', role: 'Alice', title: '收到 Bob 的放款草稿', input: 'Bob 放款草稿' },
  { id: 'bob-broadcast', role: 'Bob', title: '收到 Alice 签名的放款包', input: 'Alice 已签放款包' },
  { id: 'alice-repay', role: 'Alice', title: '发起正常还款', input: '活动贷款记录' },
  { id: 'bob-repay', role: 'Bob', title: '确认还款并返还抵押品', input: 'Alice 已签还款包' },
  { id: 'bob-default', role: 'Bob', title: '到期领取抵押品', input: '活动贷款记录' },
]

function parseJson<T>(value: string, label: string): T {
  try { return JSON.parse(value) as T } catch { throw new Error(`${label}不是有效的 JSON`) }
}

function sameAddress(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function explorer(txid: string) {
  return `https://mempool.space/testnet4/tx/${txid}`
}

const runLabels: Record<DeskTask, string> = {
  'bob-build': '生成 Bob 放款草稿',
  'alice-sign': '让 Alice 签署 3 笔依赖交易',
  'bob-broadcast': '让 Bob 签名并广播放款',
  'alice-repay': '让 Alice 签署还款交易',
  'bob-repay': '让 Bob 签名并广播还款',
  'bob-default': '到期领取并广播交易',
}

const riskNotes: Partial<Record<DeskTask, string>> = {
  'alice-sign': 'UniSat 会依次显示激活、Commit 和 Reveal。签名后仍不会广播，请把已签放款包交给 Bob。',
  'bob-broadcast': 'Bob 确认后将实际支付报价本金，并连续广播激活、Commit、Reveal 三笔 Testnet4 交易。',
  'alice-repay': 'Alice 将签署本金、利息和矿工费；签名后仍不会广播，需交给 Bob 确认。',
  'bob-repay': 'Bob 确认后会在同一笔交易中收到还款，并把 ORDI 抵押凭证返还 Alice。',
  'bob-default': '只有贷款期限届满后才能广播；成功后 ORDI 抵押凭证发送给 Bob。',
}

export function LoanDesk(props: Props) {
  const [task, setTask] = useState<DeskTask | null>(null)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [txids, setTxids] = useState<string[]>([])

  function choose(next: DeskTask) {
    setTask(next); setInput(''); setOutput(''); setNotice(''); setTxids([])
  }

  async function copyOutput() {
    await navigator.clipboard.writeText(output)
    setNotice('资料已复制，可以交给下一位操作人。')
  }

  async function run() {
    if (!task) return
    setBusy(true); setNotice(''); setOutput(''); setTxids([])
    try {
      if (task === 'bob-build') {
        const acceptance = parseJson<BorrowerAcceptance>(input, 'Alice 接受申请')
        if (acceptance.version !== 1 || !acceptance.terms || !acceptance.transferUtxo || !acceptance.feeUtxo) throw new Error('接受申请格式不正确')
        if (!sameAddress(props.address, acceptance.terms.lenderAddress)) throw new Error('请切换到这份报价中的 Bob 钱包')
        if (!props.apiKey) throw new Error('请先填写 UniSat OpenAPI Key')
        const [utxos, transfers] = await Promise.all([
          fetchAvailableUtxos(props.address, props.apiKey),
          fetchTransferableInscriptions(acceptance.borrowerAddress, acceptance.terms.ticker, props.apiKey),
        ])
        const collateral = transfers.find((item) => item.inscriptionId === acceptance.transferInscriptionId)
        if (!collateral || collateral.amount !== acceptance.terms.collateralAmount) throw new Error('链上没有找到金额精确匹配的 Alice Transfer 铭文')
        const collateralOutpoint = outpointFromTransfer(collateral)
        if (collateralOutpoint.txid !== acceptance.transferUtxo.txid || collateralOutpoint.vout !== acceptance.transferUtxo.vout) throw new Error('Transfer 铭文与接受申请中的 UTXO 不一致')
        const draft = buildActivationDraft({ acceptance, lenderUtxos: utxos })
        setOutput(JSON.stringify(draft, null, 2))
      }

      if (task === 'alice-sign') {
        const draft = parseJson<ActivationDraft>(input, 'Bob 放款草稿')
        validateActivationDraft(draft)
        if (!sameAddress(props.address, draft.borrowerAddress)) throw new Error('请切换到这笔贷款中的 Alice 钱包')
        const activationPsbt = await props.signPsbt(draft.activationPsbt, draft.borrowerActivationInputs, false)
        const commitPsbt = await props.signPsbt(draft.commitPsbt, draft.borrowerCommitInputs, true)
        const revealPsbt = await props.signPsbt(draft.revealPsbt, draft.borrowerRevealInputs, true)
        const signed: BorrowerSignedActivation = { kind: 'borrower-signed-activation', draft, activationPsbt, commitPsbt, revealPsbt }
        setOutput(JSON.stringify(signed, null, 2))
      }

      if (task === 'bob-broadcast') {
        const signed = parseJson<BorrowerSignedActivation>(input, 'Alice 已签放款包')
        validateBorrowerSignedActivation(signed)
        if (!sameAddress(props.address, signed.draft.terms.lenderAddress)) throw new Error('请切换到这笔贷款中的 Bob 钱包')
        const activation = await props.signPsbt(signed.activationPsbt, signed.draft.lenderActivationInputs, true)
        const pushWithRetry = async (psbt: string, expected: string) => {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try { return await props.pushPsbt(psbt) } catch (reason) {
              const message = reason instanceof Error ? reason.message : String(reason)
              if (/already|known|mempool/i.test(message)) return expected
              if (attempt === 4 || !/missing|input|parent|not found/i.test(message)) throw reason
              await new Promise((resolve) => setTimeout(resolve, 800))
            }
          }
          return expected
        }
        const activationTxid = await pushWithRetry(activation, signed.draft.activationTxid)
        const commitTxid = await pushWithRetry(signed.commitPsbt, signed.draft.commitTxid)
        const revealTxid = await pushWithRetry(signed.revealPsbt, signed.draft.revealTxid)
        if (activationTxid !== signed.draft.activationTxid || commitTxid !== signed.draft.commitTxid || revealTxid !== signed.draft.revealTxid) throw new Error('广播返回的交易编号与双方核对的草稿不一致')
        const record = activeRecordFromDraft(signed.draft)
        setTxids([activationTxid, commitTxid, revealTxid])
        setOutput(JSON.stringify(record, null, 2))
      }

      if (task === 'alice-repay') {
        const record = parseJson<ActiveLoanRecord>(input, '活动贷款记录')
        if (record.kind !== 'brc20-active-loan') throw new Error('这不是活动贷款记录')
        if (!sameAddress(props.address, record.borrowerAddress)) throw new Error('请切换到这笔贷款中的 Alice 钱包')
        if (!props.apiKey) throw new Error('请先填写 UniSat OpenAPI Key')
        const utxos = await fetchAvailableUtxos(props.address, props.apiKey)
        const draft = buildRepaymentDraft(record, utxos, 1)
        const psbt = await props.signPsbt(draft.psbt, draft.borrowerInputs, false)
        const signed: BorrowerSignedRepayment = { kind: 'borrower-signed-repayment', record, psbt, lenderInputs: draft.lenderInputs, repay: draft.repay, fee: draft.fee }
        setOutput(JSON.stringify(signed, null, 2))
      }

      if (task === 'bob-repay') {
        const signed = parseJson<BorrowerSignedRepayment>(input, 'Alice 已签还款包')
        if (signed.kind !== 'borrower-signed-repayment') throw new Error('这不是 Alice 已签还款包')
        if (!sameAddress(props.address, signed.record.terms.lenderAddress)) throw new Error('请切换到这笔贷款中的 Bob 钱包')
        const bothSigned = await props.signPsbt(signed.psbt, signed.lenderInputs, false)
        const finalized = finalizeCooperativeRepayment(bothSigned, signed.record)
        const txid = await props.pushPsbt(finalized)
        setTxids([txid])
        setOutput(JSON.stringify({ kind: 'brc20-loan-repaid', offerId: signed.record.offerId, txid, repaidAt: new Date().toISOString() }, null, 2))
      }

      if (task === 'bob-default') {
        const record = parseJson<ActiveLoanRecord>(input, '活动贷款记录')
        if (record.kind !== 'brc20-active-loan') throw new Error('这不是活动贷款记录')
        if (!sameAddress(props.address, record.terms.lenderAddress)) throw new Error('请切换到这笔贷款中的 Bob 钱包')
        if (!props.apiKey) throw new Error('请先填写 UniSat OpenAPI Key')
        const utxos = await fetchAvailableUtxos(props.address, props.apiKey)
        const claim = buildDefaultClaim(record, utxos, 1)
        const signedPsbt = await props.signPsbt(claim.psbt, claim.lenderInputs, true)
        const txid = await props.pushPsbt(signedPsbt)
        setTxids([txid])
        setOutput(JSON.stringify({ kind: 'brc20-loan-defaulted', offerId: record.offerId, txid, defaultedAt: new Date().toISOString() }, null, 2))
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setNotice(/non.?final|non-BIP68/i.test(message) ? '贷款期限还没有到，请等待约定区块数确认后再领取。' : message)
    } finally {
      setBusy(false)
    }
  }

  if (!task) return (
    <div className="desk-tasks">
      <h2>你现在要处理哪一步？</h2>
      <p>看对方发给你的文件名称，选择对应操作。</p>
      <div>{tasks.map((item) => <button key={item.id} onClick={() => choose(item.id)}><small>{item.role}</small><b>{item.title}</b><span>需要：{item.input}</span></button>)}</div>
    </div>
  )

  const selected = tasks.find((item) => item.id === task)!
  return (
    <div className="desk-operation">
      <button className="back-link inline" onClick={() => setTask(null)}>← 重新选择任务</button>
      <span className="step-tag">{selected.role} 的操作</span>
      <h1>{selected.title}</h1>
      <p className="lead">粘贴完整的“{selected.input}”。页面会核对当前钱包角色，再构造或签署下一步。</p>
      <div className="callout warning"><b>Testnet4 实盘验证状态</b><p>交易协议和签名路径已经通过自动化测试；这一版尚未完成两只真实 UniSat 钱包的整套广播验收。请只使用测试币，并逐项核对钱包弹窗。</p></div>
      {riskNotes[task] && <div className="callout warning"><b>这一步会发生什么</b><p>{riskNotes[task]}</p></div>}
      {!props.apiKey && ['bob-build', 'alice-repay', 'bob-default'].includes(task) && <label className="desk-key">UniSat OpenAPI Key<input type="password" value={props.manualApiKey} onChange={(event) => props.setManualApiKey(event.target.value)} placeholder="本地测试临时 Key" /></label>}
      <textarea className="paste-area" value={input} onChange={(event) => setInput(event.target.value)} placeholder={`粘贴${selected.input} JSON…`} />
      <div className="actions"><button className="primary large" disabled={busy || !input.trim()} onClick={run}>{busy ? '正在处理，请查看钱包…' : runLabels[task]}</button></div>
      {notice && <div className={output ? 'callout success' : 'callout danger'}><b>{output ? '已完成' : '暂时无法继续'}</b><p>{notice}</p></div>}
      {txids.length > 0 && <div className="tx-links">{txids.map((txid, index) => <a href={explorer(txid)} target="_blank" rel="noreferrer" key={txid}>交易 {index + 1}：{txid.slice(0, 12)}… ↗</a>)}</div>}
      {output && <><textarea className="offer-json" readOnly value={output} /><div className="actions"><button className="primary large" onClick={copyOutput}>复制给下一步</button></div></>}
    </div>
  )
}
