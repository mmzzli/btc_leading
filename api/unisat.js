const BASE_URL = 'https://open-api-testnet4.unisat.io/v1/indexer'

function required(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label}格式不正确`)
  return value
}

function upstreamUrl(query) {
  const resource = query.resource
  const address = () => required(query.address, /^tb1[qp][a-z0-9]{38,}$/i, '地址')
  if (resource === 'balances') {
    return `${BASE_URL}/address/${encodeURIComponent(address())}/brc20/summary?start=0&limit=100&exclude_zero=true`
  }
  if (resource === 'transferables') {
    const ticker = required(query.ticker, /^[a-z0-9]{4}$/i, 'Ticker')
    return `${BASE_URL}/address/${encodeURIComponent(address())}/brc20/${encodeURIComponent(ticker)}/transferable-inscriptions?start=0&limit=100`
  }
  if (resource === 'available-utxos') {
    return `${BASE_URL}/address/${encodeURIComponent(address())}/available-utxo-data?cursor=0&size=100`
  }
  if (resource === 'utxo') {
    const txid = required(query.txid, /^[0-9a-f]{64}$/i, '交易编号')
    const vout = required(query.vout, /^\d{1,5}$/, '输出序号')
    return `${BASE_URL}/utxo/${txid}/${vout}`
  }
  throw new Error('不支持的查询类型')
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET') return response.status(405).json({ code: -1, msg: '只支持 GET 请求' })
  const apiKey = process.env.UNISAT_OPENAPI_KEY
  if (!apiKey) return response.status(503).json({ code: -1, msg: 'Vercel 尚未配置 UNISAT_OPENAPI_KEY' })
  try {
    const upstream = await fetch(upstreamUrl(request.query), { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
    const text = await upstream.text()
    response.status(upstream.status)
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8')
    return response.send(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UniSat 查询失败'
    return response.status(400).json({ code: -1, msg: message })
  }
}
