import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const b64 = process.env.PLAID_TOKEN_ENC_KEY
  if (!b64) throw new Error('PLAID_TOKEN_ENC_KEY is not set')
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('PLAID_TOKEN_ENC_KEY must be a base64-encoded 32-byte key')
  }
  return key
}

/** Encrypts a token to a `iv:authTag:ciphertext` string (all base64). */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/** Reverses `encryptToken`. Throws if the payload is malformed or tampered with. */
export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed ciphertext')
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
