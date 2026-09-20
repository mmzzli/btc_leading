export interface Brc20Balance {
  ticker: string
  availableBalance: string
  transferableBalance: string
  overallBalance: string
}

export interface TransferableInscription {
  inscriptionId: string
  ticker: string
  amount: string
  outputValue?: number
  location?: string
}

interface UniSatResponse {
  code: number
  msg: string
  data?: { detail?: Brc20Balance[]; list?: Brc20Balance[] }
}

interface UniSatTransferResponse {
  code: number
  msg: string
  data?: { detail?: Array<Record<string, unknown>>; list?: Array<Record<string, unknown>> }
}

export async function fetchBrc20Balances(address: string, apiKey: string): Promise<Brc20Balance[]> {
  if (!apiKey) throw new Error('商业资产查询服务尚未配置')
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/address/${encodeURIComponent(address)}/brc20/summary`)
  endpoint.searchParams.set('start', '0')
  endpoint.searchParams.set('limit', '100')
  endpoint.searchParams.set('exclude_zero', 'true')
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) throw new Error(`资产服务返回 HTTP ${response.status}`)
  const body = await response.json() as UniSatResponse
  if (body.code !== 0) throw new Error(body.msg || '无法读取 BRC-20 资产')
  return body.data?.detail ?? body.data?.list ?? []
}

export async function fetchTransferableInscriptions(address: string, ticker: string, apiKey: string): Promise<TransferableInscription[]> {
  if (!apiKey) throw new Error('商业资产查询服务尚未配置')
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/address/${encodeURIComponent(address)}/brc20/${encodeURIComponent(ticker)}/transferable-inscriptions`)
  endpoint.searchParams.set('start', '0')
  endpoint.searchParams.set('limit', '100')
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) throw new Error(`Transfer 铭文查询返回 HTTP ${response.status}`)
  const body = await response.json() as UniSatTransferResponse
  if (body.code !== 0) throw new Error(body.msg || '无法读取 Transfer 铭文')
  const rows = body.data?.detail ?? body.data?.list ?? []
  return rows.map((row) => ({
    inscriptionId: String(row.inscriptionId ?? ''),
    ticker: String(row.ticker ?? row.tick ?? ticker),
    amount: String(row.amount ?? '0'),
    outputValue: row.outputValue == null ? undefined : Number(row.outputValue),
    location: row.location == null ? undefined : String(row.location),
  })).filter((item) => item.inscriptionId)
}
