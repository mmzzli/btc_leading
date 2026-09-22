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

function proxyUrl(resource: string, values: Record<string, string | number>): URL {
  const endpoint = new URL('/api/unisat', window.location.origin)
  endpoint.searchParams.set('resource', resource)
  Object.entries(values).forEach(([key, value]) => endpoint.searchParams.set(key, String(value)))
  return endpoint
}

async function getJson<T>(endpoint: URL, apiKey: string, proxy: { resource: string; values: Record<string, string | number> }): Promise<T> {
  const target = apiKey ? endpoint : proxyUrl(proxy.resource, proxy.values)
  const response = await fetch(target, apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined)
  if (!response.ok) throw new Error(`UniSat 查询返回 HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function fetchBrc20Balances(address: string, apiKey: string): Promise<Brc20Balance[]> {
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/address/${encodeURIComponent(address)}/brc20/summary`)
  endpoint.searchParams.set('start', '0')
  endpoint.searchParams.set('limit', '100')
  endpoint.searchParams.set('exclude_zero', 'true')
  const body = await getJson<UniSatResponse>(endpoint, apiKey, { resource: 'balances', values: { address } })
  if (body.code !== 0) throw new Error(body.msg || '无法读取 BRC-20 资产')
  return body.data?.detail ?? body.data?.list ?? []
}

export async function fetchTransferableInscriptions(address: string, ticker: string, apiKey: string): Promise<TransferableInscription[]> {
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/address/${encodeURIComponent(address)}/brc20/${encodeURIComponent(ticker)}/transferable-inscriptions`)
  endpoint.searchParams.set('start', '0')
  endpoint.searchParams.set('limit', '100')
  const body = await getJson<UniSatTransferResponse>(endpoint, apiKey, { resource: 'transferables', values: { address, ticker } })
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
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/address/${encodeURIComponent(address)}/available-utxo-data`)
  endpoint.searchParams.set('cursor', '0')
  endpoint.searchParams.set('size', '100')
  const body = await getJson<UniSatUtxoResponse>(endpoint, apiKey, { resource: 'available-utxos', values: { address } })
  if (body.code !== 0) throw new Error(body.msg || '无法读取可用 BTC UTXO')
  const data = body.data
  if (!data || !('utxo' in data)) return []
  return (data.utxo ?? []).filter((utxo) => !utxo.isSpent && utxo.satoshi > 0 && Boolean(utxo.scriptPk))
}

export async function fetchUtxo(txid: string, vout: number, apiKey: string): Promise<ChainUtxo> {
  const endpoint = new URL(`https://open-api-testnet4.unisat.io/v1/indexer/utxo/${encodeURIComponent(txid)}/${vout}`)
  const body = await getJson<UniSatUtxoResponse>(endpoint, apiKey, { resource: 'utxo', values: { txid, vout } })
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
