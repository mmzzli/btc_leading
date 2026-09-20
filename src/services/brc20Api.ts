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

export interface ChainUtxo {
  txid: string
  vout: number
  satoshi: number
  scriptPk: string
  scriptType?: string
  address?: string
  isSpent?: boolean
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

interface UniSatUtxoResponse {
  code: number
  msg: string
  data?: { utxo?: ChainUtxo[] } | ChainUtxo | null
}

async function getJson<T>(endpoint: URL, apiKey: string): Promise<T> {
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) throw new Error(`UniSat 查询返回 HTTP ${response.status}`)
  return response.json() as Promise<T>
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

export async function fetchAvailableUtxos(address: string, apiKey: string): Promise<ChainUtxo[]> {
  if (!apiKey) throw new Error('商业资产查询服务尚未配置')
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/address/${encodeURIComponent(address)}/available-utxo-data`)
  endpoint.searchParams.set('cursor', '0')
  endpoint.searchParams.set('size', '100')
  const body = await getJson<UniSatUtxoResponse>(endpoint, apiKey)
  if (body.code !== 0) throw new Error(body.msg || '无法读取可用 BTC UTXO')
  const data = body.data
  if (!data || !('utxo' in data)) return []
  return (data.utxo ?? []).filter((utxo) => !utxo.isSpent && utxo.satoshi > 0 && Boolean(utxo.scriptPk))
}

export async function fetchUtxo(txid: string, vout: number, apiKey: string): Promise<ChainUtxo> {
  if (!apiKey) throw new Error('商业资产查询服务尚未配置')
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/utxo/${encodeURIComponent(txid)}/${vout}`)
  const body = await getJson<UniSatUtxoResponse>(endpoint, apiKey)
  if (body.code !== 0 || !body.data || 'utxo' in body.data) throw new Error(body.msg || '无法读取指定 UTXO')
  const utxo = body.data as ChainUtxo
  if (utxo.isSpent) throw new Error('指定 UTXO 已经花费')
  return utxo
}

export function outpointFromTransfer(item: TransferableInscription): { txid: string; vout: number } {
  if (item.location) {
    const [txid, vout] = item.location.split(':')
    if (/^[0-9a-f]{64}$/i.test(txid) && /^\d+$/.test(vout)) return { txid, vout: Number(vout) }
  }
  const match = item.inscriptionId.match(/^([0-9a-f]{64})i(\d+)$/i)
  if (!match) throw new Error('Transfer 铭文缺少可识别的链上位置')
  return { txid: match[1], vout: Number(match[2]) }
}
