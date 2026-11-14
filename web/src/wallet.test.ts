import { describe, expect, it } from 'vitest'
import type { EIP1193Provider } from 'viem'
import { pickProvider, type WalletDetail } from './wallet'

const prov = (tag: string) => ({ tag }) as unknown as EIP1193Provider
const w = (name: string, rdns: string, p: EIP1193Provider): WalletDetail => ({ info: { uuid: rdns, name, icon: '', rdns }, provider: p })

describe('pickProvider (MetaMask and QIE Wallet both installed)', () => {
  const mm = prov('mm'), qie = prov('qie'), injected = prov('injected')
  const both = [w('MetaMask', 'io.metamask', mm), w('QIE Wallet', 'me.qiewallet', qie)]
  it('prefers QIE Wallet over MetaMask and over window.ethereum', () => {
    expect(pickProvider(both, null, injected)).toBe(qie)
  })
  it('honours a remembered choice', () => {
    expect(pickProvider(both, 'io.metamask', injected)).toBe(mm)
  })
  it('ignores a remembered wallet that is no longer installed', () => {
    expect(pickProvider(both, 'gone.wallet', injected)).toBe(qie)
  })
  it('falls back to window.ethereum, then the first announced wallet', () => {
    expect(pickProvider([w('MetaMask', 'io.metamask', mm)], null, injected)).toBe(injected)
    expect(pickProvider([w('MetaMask', 'io.metamask', mm)], null, undefined)).toBe(mm)
    expect(pickProvider([], null, undefined)).toBeUndefined()
  })
})
