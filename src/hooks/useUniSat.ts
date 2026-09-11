import { useCallback, useEffect, useRef, useState } from 'react'

export interface WalletSnapshot {
  address: string
  publicKey: string
  chain: UniSatChain
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useUniSat() {
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const connectingRef = useRef(false)

  const readWallet = useCallback(async (accounts?: string[]) => {
    if (!window.unisat) throw new Error('没有检测到 UniSat Wallet')
    const currentAccounts = accounts ?? await window.unisat.getAccounts()
    if (!currentAccounts[0]) {
      setWallet(null)
      return
    }
    const [publicKey, chain] = await Promise.all([
      window.unisat.getPublicKey(),
      window.unisat.getChain(),
    ])
    setWallet({ address: currentAccounts[0], publicKey, chain })
  }, [])

  const connect = useCallback(async () => {
    if (connectingRef.current) return
    if (!window.unisat) {
      setError('请先安装并打开 UniSat Wallet')
      return
    }
    connectingRef.current = true
    setConnecting(true)
    setError('')
    try {
      const accounts = await window.unisat.requestAccounts()
      await readWallet(accounts)
    } catch (reason) {
      const text = messageFrom(reason)
      setError(/pending|approval/i.test(text) ? '钱包里已有一个待处理请求，请先完成或关闭它' : text)
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }, [readWallet])

  const switchToTestnet4 = useCallback(async () => {
    if (!window.unisat) return
    setError('')
    try {
      await window.unisat.switchChain('BITCOIN_TESTNET4')
      await readWallet()
    } catch (reason) {
      setError(messageFrom(reason))
    }
  }, [readWallet])

  useEffect(() => {
    if (!window.unisat) return
    const handleAccounts = (accounts: string[]) => void readWallet(accounts).catch((reason) => setError(messageFrom(reason)))
    const handleNetwork = () => void readWallet().catch((reason) => setError(messageFrom(reason)))
    window.unisat.on('accountsChanged', handleAccounts)
    window.unisat.on('networkChanged', handleNetwork)
    return () => {
      window.unisat?.removeListener('accountsChanged', handleAccounts)
      window.unisat?.removeListener('networkChanged', handleNetwork)
    }
  }, [readWallet])

  return {
    installed: typeof window !== 'undefined' && Boolean(window.unisat),
    wallet,
    connecting,
    error,
    isTestnet4: wallet?.chain.enum === 'BITCOIN_TESTNET4',
    connect,
    switchToTestnet4,
  }
}
