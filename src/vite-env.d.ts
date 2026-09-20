/// <reference types="vite/client" />

interface UniSatChain {
  enum: string
  name: string
  network: string
}

interface UniSatWallet {
  requestAccounts(): Promise<string[]>
  getAccounts(): Promise<string[]>
  getPublicKey(): Promise<string>
  getChain(): Promise<UniSatChain>
  disconnect?(): Promise<void>
  switchChain(chain: string): Promise<UniSatChain>
  signMessage(message: string, type?: 'ecdsa' | 'bip322-simple'): Promise<string>
  inscribeTransfer(ticker: string, amount: string): Promise<void>
  signPsbt(psbtHex: string, options?: { autoFinalized?: boolean; toSignInputs?: Array<{ index: number; publicKey?: string; address?: string; sighashTypes?: number[]; useTweakedSigner?: boolean }> }): Promise<string | Record<string, unknown>>
  pushPsbt(psbtHex: string): Promise<string>
  on(event: 'accountsChanged', handler: (accounts: string[]) => void): void
  on(event: 'networkChanged', handler: (network: string) => void): void
  removeListener(event: 'accountsChanged', handler: (accounts: string[]) => void): void
  removeListener(event: 'networkChanged', handler: (network: string) => void): void
}

interface Window {
  unisat?: UniSatWallet
}
