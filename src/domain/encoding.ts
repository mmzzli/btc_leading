export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hexadecimal value')
  }

  return Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function toXOnly(compressedPubkey: Uint8Array): Uint8Array {
  if (compressedPubkey.length !== 33 || ![2, 3].includes(compressedPubkey[0])) {
    throw new Error('Expected a compressed secp256k1 public key')
  }

  return compressedPubkey.slice(1)
}
