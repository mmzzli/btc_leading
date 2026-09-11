import { useMemo, useState } from 'react'
import { exampleLoanTerms } from './domain/fixtures'
import {
  canonicalizeLoanTerms,
  loanIdFromTerms,
  type LoanTerms,
  validateLoanTerms,
} from './domain/loanTerms'
import { buildActiveVault, buildPendingVault } from './domain/vaults'
import { useUniSat } from './hooks/useUniSat'

type Role = 'borrower' | 'lender'

function short(value: string, size = 9) {
  return value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-size)}` : value
}

function App() {
  const wallet = useUniSat()
  const [role, setRole] = useState<Role>('borrower')
  const [terms, setTerms] = useState<LoanTerms>(exampleLoanTerms)
  const [importText, setImportText] = useState('')
  const [notice, setNotice] = useState('')

  const draft = useMemo(() => {
    const next = { ...terms }
    if (wallet.wallet && role === 'borrower') {
      next.borrowerAddress = wallet.wallet.address
      next.borrowerPubkey = wallet.wallet.publicKey.toLowerCase()
    }
    if (wallet.wallet && role === 'lender') {
      next.lenderAddress = wallet.wallet.address
      next.lenderPubkey = wallet.wallet.publicKey.toLowerCase()
    }
    return next
  }, [role, terms, wallet.wallet])

  const errors = useMemo(() => validateLoanTerms(draft), [draft])
  const vaults = useMemo(() => {
    if (errors.length) return null
    const keys = { borrowerPubkey: draft.borrowerPubkey, lenderPubkey: draft.lenderPubkey }
    return {
      pending: buildPendingVault({ ...keys, relativeBlocks: draft.fundingTimeoutBlocks }),
      active: buildActiveVault({ ...keys, relativeBlocks: draft.loanTermBlocks }),
    }
  }, [draft, errors.length])

  function update<K extends keyof LoanTerms>(key: K, value: LoanTerms[K]) {
    setTerms((current) => ({ ...current, [key]: value }))
    setNotice('')
  }

  async function copyOffer() {
    await navigator.clipboard.writeText(canonicalizeLoanTerms(draft))
    setNotice('贷款提议已复制，可以发给另一方核对。')
  }

  function importOffer() {
    try {
      const parsed = JSON.parse(importText) as LoanTerms
      const importedErrors = validateLoanTerms(parsed)
      if (importedErrors.length) throw new Error(importedErrors.join('；'))
      setTerms(parsed)
      setNotice('贷款提议已导入，请逐项核对。')
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '无法导入贷款提议')
    }
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <span className="eyebrow">BITCOIN TESTNET4 · RUNES</span>
          <h1>Rune 借贷实验室</h1>
          <p>先核对规则，再动链上资产。</p>
        </div>
        {wallet.wallet ? (
          <div className="wallet-pill">
            <span className={wallet.isTestnet4 ? 'dot ok' : 'dot'} />
            <div><b>{short(wallet.wallet.address)}</b><small>{wallet.wallet.chain.name}</small></div>
          </div>
        ) : (
          <button className="primary" disabled={wallet.connecting} onClick={wallet.connect}>
            {wallet.connecting ? '等待钱包确认…' : '连接 UniSat'}
          </button>
        )}
      </header>

      {!wallet.installed && <div className="banner danger">当前浏览器没有检测到 UniSat Wallet。</div>}
      {wallet.wallet && !wallet.isTestnet4 && (
        <div className="banner warning">
          当前不是 Bitcoin Testnet4，创建和签名功能已锁定。
          <button onClick={wallet.switchToTestnet4}>切换到 Testnet4</button>
        </div>
      )}
      {wallet.error && <div className="banner danger">{wallet.error}</div>}

      <section className="steps" aria-label="开发阶段">
        <div className="step done"><span>✓</span><b>规则与金库</b><small>阶段 0</small></div>
        <div className="line active" />
        <div className="step active"><span>2</span><b>双方确认条款</b><small>当前阶段</small></div>
        <div className="line" />
        <div className="step"><span>3</span><b>锁入抵押品</b><small>尚未开放</small></div>
        <div className="line" />
        <div className="step"><span>4</span><b>放款与还款</b><small>尚未开放</small></div>
      </section>

      <section className="role-card">
        <div><span className="eyebrow">你现在扮演谁？</span><h2>{role === 'borrower' ? 'Alice · 借款人' : 'Bob · 出借人'}</h2></div>
        <div className="segmented">
          <button className={role === 'borrower' ? 'selected' : ''} onClick={() => setRole('borrower')}>我要借款</button>
          <button className={role === 'lender' ? 'selected' : ''} onClick={() => setRole('lender')}>我要出借</button>
        </div>
      </section>

      <div className="layout">
        <section className="panel">
          <div className="panel-title"><span>01</span><div><h2>填写贷款条款</h2><p>这里只生成提议，不会发交易。</p></div></div>
          <div className="form-grid">
            <label>Rune ID<input value={terms.runeId} onChange={(e) => update('runeId', e.target.value)} placeholder="例如 840000:1" /></label>
            <label>抵押数量<input value={terms.collateralAmount} onChange={(e) => update('collateralAmount', e.target.value)} inputMode="numeric" /></label>
            <label>借款本金（sats）<input type="number" value={terms.principalSats} onChange={(e) => update('principalSats', Number(e.target.value))} /></label>
            <label>固定利息（sats）<input type="number" value={terms.interestSats} onChange={(e) => update('interestSats', Number(e.target.value))} /></label>
            <label>借款期限（区块）<input type="number" value={terms.loanTermBlocks} onChange={(e) => update('loanTermBlocks', Number(e.target.value))} /></label>
            <label>等待放款（区块）<input type="number" value={terms.fundingTimeoutBlocks} onChange={(e) => update('fundingTimeoutBlocks', Number(e.target.value))} /></label>
          </div>
          <details>
            <summary>双方地址和公钥</summary>
            <div className="form-grid technical">
              <label>Alice 地址<input value={draft.borrowerAddress} onChange={(e) => update('borrowerAddress', e.target.value)} disabled={role === 'borrower' && Boolean(wallet.wallet)} /></label>
              <label>Alice 公钥<input value={draft.borrowerPubkey} onChange={(e) => update('borrowerPubkey', e.target.value)} disabled={role === 'borrower' && Boolean(wallet.wallet)} /></label>
              <label>Bob 地址<input value={draft.lenderAddress} onChange={(e) => update('lenderAddress', e.target.value)} disabled={role === 'lender' && Boolean(wallet.wallet)} /></label>
              <label>Bob 公钥<input value={draft.lenderPubkey} onChange={(e) => update('lenderPubkey', e.target.value)} disabled={role === 'lender' && Boolean(wallet.wallet)} /></label>
            </div>
          </details>
          {errors.length > 0 && <ul className="errors">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
        </section>

        <aside className="panel summary">
          <div className="panel-title"><span>02</span><div><h2>双方要确认什么</h2><p>每一项变化都会生成新的贷款编号。</p></div></div>
          <div className="deal"><div><small>Alice 锁入</small><strong>{draft.collateralAmount} Rune</strong></div><span>⇄</span><div><small>Bob 放款</small><strong>{draft.principalSats.toLocaleString()} sats</strong></div></div>
          <dl>
            <div><dt>到期应还</dt><dd>{(draft.principalSats + draft.interestSats).toLocaleString()} sats</dd></div>
            <div><dt>贷款期限</dt><dd>{draft.loanTermBlocks} 个区块</dd></div>
            <div><dt>未放款退款</dt><dd>{draft.fundingTimeoutBlocks} 个区块后</dd></div>
            <div><dt>贷款编号</dt><dd className="mono">{errors.length ? '条款有误' : loanIdFromTerms(draft)}</dd></div>
          </dl>
          {vaults && <div className="vault-preview"><div><small>等待放款金库</small><code>{short(vaults.pending.address, 12)}</code></div><div><small>活动贷款金库</small><code>{short(vaults.active.address, 12)}</code></div></div>}
          <button className="primary full" disabled={errors.length > 0} onClick={copyOffer}>复制贷款提议</button>
          {notice && <p className="notice">{notice}</p>}
        </aside>
      </div>

      <section className="panel import-panel">
        <div><span className="eyebrow">收到对方的提议？</span><h2>粘贴并独立核对</h2></div>
        <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="在这里粘贴贷款提议 JSON" />
        <button onClick={importOffer}>导入提议</button>
      </section>
    </main>
  )
}

export default App
