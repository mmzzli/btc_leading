import { useMemo, useState } from 'react'
import {
  canonicalizeOffer,
  createNonce,
  offerId,
  parseSignedOffer,
  validateOfferTerms,
  type Brc20OfferTerms,
  type SignedBrc20Offer,
} from './domain/brc20Offer'
import { useUniSat } from './hooks/useUniSat'
import { fetchBrc20Balances, type Brc20Balance } from './services/brc20Api'

type Flow = 'lender' | 'borrower'

interface OfferForm {
  ticker: string
  collateralAmount: string
  principalSats: number
  interestSats: number
  termBlocks: number
  expiresHours: number
}

const initialForm: OfferForm = {
  ticker: 'ORDI',
  collateralAmount: '100',
  principalSats: 10_000,
  interestSats: 500,
  termBlocks: 10,
  expiresHours: 24,
}

const lenderSteps = ['选择身份', '连接钱包', '设置报价', '核对并签名', '分享报价']
const borrowerSteps = ['选择身份', '连接钱包', '导入报价', '核对报价', '检查抵押品']

function short(value: string, size = 8) {
  return value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-size)}` : value
}

function Guide({ action, result }: { action: string; result: string }) {
  return (
    <div className="guide">
      <div><span>1</span><p><b>你需要做什么</b>{action}</p></div>
      <div><span>2</span><p><b>完成后会看到</b>{result}</p></div>
    </div>
  )
}

function Progress({ labels, step }: { labels: string[]; step: number }) {
  return (
    <nav className="progress" aria-label="操作进度">
      {labels.map((label, index) => (
        <div className={index < step ? 'complete' : index === step ? 'current' : ''} key={label}>
          <span>{index < step ? '✓' : index + 1}</span><small>{label}</small>
        </div>
      ))}
    </nav>
  )
}

function OfferSummary({ terms }: { terms: Brc20OfferTerms }) {
  return (
    <div className="summary-card">
      <div className="exchange">
        <div><small>Bob 借出</small><strong>{terms.principalSats.toLocaleString()} sats</strong></div>
        <span>⇄</span>
        <div><small>Alice 抵押</small><strong>{terms.collateralAmount} {terms.ticker.toUpperCase()}</strong></div>
      </div>
      <dl>
        <div><dt>到期应还</dt><dd>{(terms.principalSats + terms.interestSats).toLocaleString()} sats</dd></div>
        <div><dt>固定利息</dt><dd>{terms.interestSats.toLocaleString()} sats</dd></div>
        <div><dt>贷款期限</dt><dd>{terms.termBlocks} 个区块（约 {Math.round(terms.termBlocks * 10 / 60 * 10) / 10} 小时）</dd></div>
        <div><dt>报价失效</dt><dd>{new Date(terms.expiresAt).toLocaleString()}</dd></div>
        <div><dt>报价编号</dt><dd className="mono">{offerId(terms)}</dd></div>
      </dl>
    </div>
  )
}

function App() {
  const wallet = useUniSat()
  const [flow, setFlow] = useState<Flow | null>(null)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<OfferForm>(initialForm)
  const [frozenTerms, setFrozenTerms] = useState<Brc20OfferTerms | null>(null)
  const [signedOffer, setSignedOffer] = useState<SignedBrc20Offer | null>(null)
  const [importText, setImportText] = useState('')
  const [importedOffer, setImportedOffer] = useState<SignedBrc20Offer | null>(null)
  const [balances, setBalances] = useState<Brc20Balance[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const labels = flow === 'lender' ? lenderSteps : borrowerSteps
  const selectedBalance = useMemo(() => importedOffer && balances
    ? balances.find((item) => item.ticker.toLowerCase() === importedOffer.terms.ticker.toLowerCase())
    : undefined, [balances, importedOffer])

  function selectFlow(next: Flow) {
    setFlow(next)
    setStep(1)
    setNotice('')
  }

  function reset() {
    setFlow(null)
    setStep(0)
    setFrozenTerms(null)
    setSignedOffer(null)
    setImportedOffer(null)
    setBalances(null)
    setNotice('')
  }

  function freezeOffer() {
    if (!wallet.wallet || !wallet.isTestnet4) return
    const created = new Date()
    const terms: Brc20OfferTerms = {
      version: 1,
      network: 'bitcoin-testnet4',
      collateralProtocol: 'brc-20',
      ticker: form.ticker.toUpperCase(),
      collateralAmount: form.collateralAmount,
      principalSats: form.principalSats,
      interestSats: form.interestSats,
      termBlocks: form.termBlocks,
      lenderAddress: wallet.wallet.address,
      lenderPubkey: wallet.wallet.publicKey.toLowerCase(),
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + form.expiresHours * 3_600_000).toISOString(),
      nonce: createNonce(),
    }
    const errors = validateOfferTerms(terms)
    if (errors.length) {
      setNotice(errors.join('；'))
      return
    }
    setFrozenTerms(terms)
    setNotice('')
    setStep(3)
  }

  async function signOffer() {
    if (!frozenTerms) return
    setBusy(true)
    setNotice('')
    try {
      const message = `BRC20_LOAN_OFFER\n${canonicalizeOffer(frozenTerms)}`
      const signature = await wallet.signMessage(message)
      setSignedOffer({ offerId: offerId(frozenTerms), terms: frozenTerms, signature, signatureProtocol: 'bip322-simple' })
      setStep(4)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '钱包签名失败')
    } finally {
      setBusy(false)
    }
  }

  async function copyOffer() {
    if (!signedOffer) return
    await navigator.clipboard.writeText(JSON.stringify(signedOffer, null, 2))
    setNotice('报价已复制。现在把它发给 Alice。')
  }

  function importOffer() {
    try {
      const parsed = parseSignedOffer(importText)
      setImportedOffer(parsed)
      setNotice('')
      setStep(3)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '无法读取报价')
    }
  }

  async function checkBalances() {
    if (!wallet.wallet || !importedOffer) return
    setBusy(true)
    setNotice('')
    try {
      const data = await fetchBrc20Balances(wallet.wallet.address, import.meta.env.VITE_UNISAT_OPENAPI_KEY ?? '')
      setBalances(data)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '无法读取 BRC-20 资产')
    } finally {
      setBusy(false)
    }
  }

  const walletStep = flow && step === 1

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={reset}><span>₿</span><div><b>BRC-20 借贷</b><small>Bitcoin Testnet4</small></div></button>
        {wallet.wallet && <div className="wallet-pill"><span className={wallet.isTestnet4 ? 'dot ok' : 'dot'} /><div><b>{short(wallet.wallet.address)}</b><small>{wallet.wallet.chain.name}</small></div></div>}
      </header>

      {!flow ? (
        <section className="welcome">
          <span className="eyebrow">测试网 · 第 1 阶段</span>
          <h1>你今天想做什么？</h1>
          <p className="lead">每次只完成一个动作。页面会先解释，再让你操作。</p>
          <div className="role-options">
            <button onClick={() => selectFlow('lender')}>
              <span className="role-icon">B</span><div><small>Bob · 出借人</small><strong>我要出借 BTC</strong><p>创建一份带钱包签名的 ORDI 抵押报价</p></div><i>→</i>
            </button>
            <button onClick={() => selectFlow('borrower')}>
              <span className="role-icon alice">A</span><div><small>Alice · 借款人</small><strong>我要抵押 BRC-20 借 BTC</strong><p>导入 Bob 的报价并检查自己的抵押资产</p></div><i>→</i>
            </button>
          </div>
          <div className="safety-strip"><b>当前不会转走资产</b><span>这一版只完成报价签名与资产检查。链上贷款协议通过验收后才开放转账。</span></div>
        </section>
      ) : (
        <>
          <Progress labels={labels} step={step} />
          <section className="focus-card">
            <button className="back-link" onClick={step === 1 ? reset : () => { setStep(step - 1); setNotice('') }}>← 返回</button>

            {walletStep && (
              <>
                <span className="step-tag">第 1 步</span>
                <h1>连接 {flow === 'lender' ? 'Bob' : 'Alice'} 的钱包</h1>
                <p className="lead">地址和公钥会自动读取，你不需要复制任何技术参数。</p>
                <Guide action="在装有 UniSat 扩展的 Chrome 中打开本页，然后点击下方按钮。" result="页面显示你的 tb1… 地址和 Bitcoin Testnet4。" />
                {!wallet.installed && <div className="callout warning"><b>这里没有检测到 UniSat</b><p>Codex 内置浏览器不能加载钱包扩展。请在 Chrome 打开 <span className="mono">http://127.0.0.1:5174/</span>。</p></div>}
                {wallet.wallet && !wallet.isTestnet4 && <div className="callout danger"><b>钱包网络不对</b><p>当前是 {wallet.wallet.chain.name}，本项目只允许 Bitcoin Testnet4。</p></div>}
                {wallet.wallet && wallet.isTestnet4 && <div className="identity"><span className="status ok">✓ 已连接</span><strong>{short(wallet.wallet.address, 12)}</strong><small>Bitcoin Testnet4</small></div>}
                {wallet.error && <p className="error-text">{wallet.error}</p>}
                <div className="actions">
                  {!wallet.wallet && <button className="primary large" disabled={wallet.connecting || !wallet.installed} onClick={wallet.connect}>{wallet.connecting ? '请在钱包中确认…' : '连接 UniSat Wallet'}</button>}
                  {wallet.wallet && !wallet.isTestnet4 && <button className="primary large" onClick={wallet.switchToTestnet4}>切换到 Testnet4</button>}
                  {wallet.wallet && wallet.isTestnet4 && <button className="primary large" onClick={() => setStep(2)}>下一步</button>}
                </div>
              </>
            )}

            {flow === 'lender' && step === 2 && (
              <>
                <span className="step-tag">第 2 步</span><h1>设置一份出借报价</h1>
                <p className="lead">Bob 只是在说明愿意按什么条件借出 BTC，此时不付款。</p>
                <Guide action="填写本金、希望 Alice 抵押的 ORDI 数量、利息和期限。" result="一张可以逐项核对的报价单。" />
                <div className="form-grid">
                  <label>抵押资产<input value={form.ticker} disabled /><small>首版固定支持 ORDI</small></label>
                  <label>要求抵押数量<input value={form.collateralAmount} inputMode="numeric" onChange={(e) => setForm({ ...form, collateralAmount: e.target.value })} /></label>
                  <label>借出本金（sats）<input type="number" min="546" value={form.principalSats} onChange={(e) => setForm({ ...form, principalSats: Number(e.target.value) })} /></label>
                  <label>固定利息（sats）<input type="number" min="0" value={form.interestSats} onChange={(e) => setForm({ ...form, interestSats: Number(e.target.value) })} /></label>
                  <label>贷款期限（区块）<input type="number" min="1" max="65535" value={form.termBlocks} onChange={(e) => setForm({ ...form, termBlocks: Number(e.target.value) })} /><small>Testnet4 出块时间会波动</small></label>
                  <label>报价有效期（小时）<input type="number" min="1" value={form.expiresHours} onChange={(e) => setForm({ ...form, expiresHours: Number(e.target.value) })} /></label>
                </div>
                <div className="plain-note"><b>这一步的费用：0 sats</b><span>不会弹出钱包，也不会广播交易。</span></div>
                {notice && <p className="error-text">{notice}</p>}
                <div className="actions"><button className="primary large" onClick={freezeOffer}>生成报价预览</button></div>
              </>
            )}

            {flow === 'lender' && step === 3 && frozenTerms && (
              <>
                <span className="step-tag">第 3 步</span><h1>签名前，请核对报价</h1>
                <p className="lead">钱包签名只证明“这份报价由 Bob 发布”，不会发送 BTC。</p>
                <Guide action="逐项核对金额，然后点击签名。在 UniSat 中确认的是一段文字。" result="得到一份 Alice 可以验证的签名报价。" />
                <OfferSummary terms={frozenTerms} />
                <div className="plain-note"><b>钱包将请求：消息签名</b><span>链上交易 0 笔，矿工费 0 sats。</span></div>
                {notice && <p className="error-text">{notice}</p>}
                <div className="actions"><button className="secondary" onClick={() => setStep(2)}>修改条件</button><button className="primary large" disabled={busy} onClick={signOffer}>{busy ? '等待钱包确认…' : '用 UniSat 签名报价'}</button></div>
              </>
            )}

            {flow === 'lender' && step === 4 && signedOffer && (
              <>
                <span className="step-tag">完成</span><div className="success-icon">✓</div><h1>报价已经签好</h1>
                <p className="lead">复制报价并发给 Alice。你的 BTC 仍在钱包里。</p>
                <Guide action="点击复制，再通过你信任的聊天工具发给 Alice。" result="Alice 导入后会看到同一份本金、抵押数量和期限。" />
                <textarea className="offer-json" readOnly value={JSON.stringify(signedOffer, null, 2)} />
                <div className="actions"><button className="primary large" onClick={copyOffer}>复制签名报价</button></div>
                {notice && <p className="success-text">{notice}</p>}
              </>
            )}

            {flow === 'borrower' && step === 2 && (
              <>
                <span className="step-tag">第 2 步</span><h1>粘贴 Bob 发来的报价</h1>
                <p className="lead">完整报价是一段 JSON 文本，里面含有条款和 Bob 的钱包签名。</p>
                <Guide action="让 Bob 在他的页面复制签名报价，然后完整粘贴到这里。" result="页面检查格式和报价编号，并展示容易看懂的报价单。" />
                <textarea className="paste-area" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="在这里粘贴 Bob 的签名报价…" />
                {notice && <p className="error-text">{notice}</p>}
                <div className="actions"><button className="primary large" disabled={!importText.trim()} onClick={importOffer}>读取报价</button></div>
              </>
            )}

            {flow === 'borrower' && step === 3 && importedOffer && (
              <>
                <span className="step-tag">第 3 步</span><h1>Alice 核对借款条件</h1>
                <p className="lead">先确认你愿意用这些 ORDI 换取这笔 BTC 贷款。</p>
                <Guide action="核对本金、抵押数量、利息和期限。当前原型尚未独立验证 Bob 的 BIP-322 签名。" result="确认后进入资产检查；商业版必须先由协调服务验签。" />
                <OfferSummary terms={importedOffer.terms} />
                <details><summary>查看 Bob 的技术信息</summary><div className="tech-list"><span>地址</span><code>{importedOffer.terms.lenderAddress}</code><span>公钥</span><code>{importedOffer.terms.lenderPubkey}</code><span>签名</span><code>{short(importedOffer.signature, 24)}</code></div></details>
                <div className="actions"><button className="secondary" onClick={() => setStep(2)}>这不是我要的</button><button className="primary large" onClick={() => setStep(4)}>条件没问题</button></div>
              </>
            )}

            {flow === 'borrower' && step === 4 && importedOffer && (
              <>
                <span className="step-tag">第 4 步</span><h1>检查你的 {importedOffer.terms.ticker} 抵押品</h1>
                <p className="lead">系统需要区分可用余额和已经制作好的 Transfer 铭文。</p>
                <Guide action="点击检查。这里只读取公开链上数据，不会让钱包签名。" result={`确认你能否准备 ${importedOffer.terms.collateralAmount} ${importedOffer.terms.ticker} 的抵押凭证。`} />
                {!balances && <button className="primary large centered" disabled={busy} onClick={checkBalances}>{busy ? '正在查询…' : '检查我的 BRC-20 资产'}</button>}
                {balances && (
                  <div className="balance-grid">
                    <div><small>钱包总余额</small><strong>{selectedBalance?.overallBalance ?? '0'} {importedOffer.terms.ticker}</strong></div>
                    <div><small>可制作 Transfer</small><strong>{selectedBalance?.availableBalance ?? '0'}</strong></div>
                    <div><small>已做好的 Transfer</small><strong>{selectedBalance?.transferableBalance ?? '0'}</strong></div>
                  </div>
                )}
                {notice && <div className="callout warning"><b>暂时无法查询</b><p>{notice}。本地开发需要在 <span className="mono">.env.local</span> 配置 UniSat OpenAPI Key；商业部署会由后端安全查询。</p></div>}
                <div className="coming-next"><b>链上步骤暂未开放</b><p>下一阶段会引导 Alice 制作精确金额的 Transfer 铭文，并让双方在同一次贷款激活中交换 BTC 与抵押品。协议通过测试向量和安全验收前，不提供会移动资产的按钮。</p></div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App
