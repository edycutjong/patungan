import { describe, expect, it, vi } from 'vitest'

// The write code and the wallet client are separate downloads. When one fails (offline, or a deploy replaced the
// files), the pages get one named error to explain, never a raw import failure.
vi.mock('./chain-write', () => {
  throw new Error('Failed to fetch dynamically imported module')
})
vi.mock('./wallet-client', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

import { NOT_LOADED, writeActions } from './chain'
import { walletFor, warmWrites } from './wallet'

describe('a lazily loaded part failing to download', () => {
  it('becomes NOT_LOADED for the write calls and for the wallet client', async () => {
    await expect(writeActions()).rejects.toThrow(NOT_LOADED)
    await expect(walletFor('0x2f4646D52a5393E239f5b880411dC2CA2D945F31')).rejects.toThrow(NOT_LOADED)
  })

  it('is swallowed by the warm-up (the write that follows reports it)', async () => {
    await expect(warmWrites()).resolves.toBeUndefined()
  })
})
