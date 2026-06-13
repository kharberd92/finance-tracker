import { describe, it, expect, beforeAll } from 'vitest'
import { encryptToken, decryptToken } from './crypto'

beforeAll(() => {
  // 32-byte key, base64-encoded, for the test run.
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('encryptToken / decryptToken', () => {
  it('round-trips a token back to the original plaintext', () => {
    const token = 'access-sandbox-abc123'
    expect(decryptToken(encryptToken(token))).toBe(token)
  })

  it('produces ciphertext that differs from the plaintext', () => {
    const token = 'access-sandbox-abc123'
    const encrypted = encryptToken(token)
    expect(encrypted).not.toContain(token)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'))
  })

  it('throws when the ciphertext has been tampered with', () => {
    const encrypted = encryptToken('access-sandbox-abc123')
    const [iv, tag, data] = encrypted.split(':')
    // Flip the last char of the ciphertext segment.
    const flipped = data.slice(0, -1) + (data.slice(-1) === 'A' ? 'B' : 'A')
    expect(() => decryptToken(`${iv}:${tag}:${flipped}`)).toThrow()
  })
})
