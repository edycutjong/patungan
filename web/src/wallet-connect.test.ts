// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EIP1193Provider } from 'viem'
import type { WalletDetail } from './wallet'
import { flush } from './test/logs'

type Wallet = typeof import('./wallet')

/** A fake EIP-1193 provider: answers each method from `answers` (a value, or a function that may throw). */
function fakeProvider(answers: Record<string, unknown> = {}) {
  const calls: { method: string; params?: unknown }[] = []
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    calls.push({ method, params })
    const a = answers[method]
    if (typeof a === 'function') return a(params)
    if (a !== undefined) return a
    if (method === 'eth_requestAccounts') return ['0x616F4e1d85D41F34330D3D0D167717c4015E69D7']
    if (method === 'eth_chainId') return '0x7c6'
    return null
  })
  return { request, on: vi.fn(), calls } as unknown as EIP1193Provider & { calls: typeof calls; request: typeof request }
}

const detail = (name: string, rdns: string, provider: EIP1193Provider, icon = ''): WalletDetail => ({ info: { uuid: `uuid-${rdns}`, name, icon, rdns }, provider })
const announce = (d: unknown) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: d }))

async function load(): Promise<Wallet> {
  vi.resetModules()
  return import('./wallet')
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  delete window.ethereum
  delete window.qie
})
afterEach(() => vi.restoreAllMocks())

describe('EIP-6963 discovery', () => {
  it('asks installed wallets to announce themselves on load', async () => {
    const seen = vi.fn()
    window.addEventListener('eip6963:requestProvider', seen)
    await load()
    expect(seen).toHaveBeenCalledTimes(1)
    window.removeEventListener('eip6963:requestProvider', seen)
  })

  it('lists each announced wallet once, QIE Wallet first, and ignores malformed announcements', async () => {
    const w = await load()
    const mm = detail('MetaMask', 'io.metamask', fakeProvider())
    announce(mm)
    announce(mm)
    announce(detail('QIE Wallet', 'me.qiewallet', fakeProvider()))
    announce(null)
    announce({ info: {} })
    announce({ info: { uuid: 'x' } })
    expect(w.wallets().map((d) => d.info.name)).toEqual(['QIE Wallet', 'MetaMask'])
  })

  it('prefers window.qie over window.ethereum when nothing announced', async () => {
    const w = await load()
    expect(w.hasWallet()).toBe(false)
    const eth = fakeProvider()
    window.ethereum = eth
    expect(w.provider()).toBe(eth)
    const qie = fakeProvider()
    window.qie = qie
    expect(w.provider()).toBe(qie)
    expect(w.hasWallet()).toBe(true)
  })
})

describe('remembered wallet choice', () => {
  it('remembers the picked wallet and forgets it on "Switch wallet"', async () => {
    const w = await load()
    const mm = fakeProvider()
    announce(detail('MetaMask', 'io.metamask', mm))
    announce(detail('QIE Wallet', 'me.qiewallet', fakeProvider()))
    w.chooseWallet('io.metamask')
    expect(localStorage.getItem('patungan.wallet')).toBe('io.metamask')
    expect(w.provider()).toBe(mm)
    w.forgetWallet()
    expect(localStorage.getItem('patungan.wallet')).toBeNull()
  })

  it('keeps working when storage is blocked (private mode)', async () => {
    const w = await load()
    const eth = fakeProvider()
    window.ethereum = eth
    const blocked = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => w.chooseWallet('io.metamask')).not.toThrow()
    expect(() => w.forgetWallet()).not.toThrow()
    expect(w.provider()).toBe(eth)
    vi.unstubAllGlobals()
  })
})

describe('connect', () => {
  it('fails with NoWallet when no wallet is installed', async () => {
    const w = await load()
    await expect(w.connect()).rejects.toThrow('NoWallet')
  })

  it('fails with NoWallet when the wallet disappears while connecting', async () => {
    const w = await load()
    window.ethereum = fakeProvider()
    const p = w.connect()
    delete window.ethereum
    await expect(p).rejects.toThrow('NoWallet')
  })

  it('returns the account without switching when the wallet is already on chain 1990 (lowercase hex)', async () => {
    const w = await load()
    const eth = fakeProvider()
    window.ethereum = eth
    const { account, wallet } = await w.connect()
    expect(account).toBe('0x616F4e1d85D41F34330D3D0D167717c4015E69D7')
    expect(wallet.chain.id).toBe(1990)
    expect(eth.calls.map((c) => c.method)).toEqual(['eth_requestAccounts', 'eth_chainId'])
  })

  it('switches the wallet to QIE mainnet when it is on another chain', async () => {
    const w = await load()
    const eth = fakeProvider({ eth_chainId: '0x1' })
    window.ethereum = eth
    await w.connect()
    expect(eth.calls[2]).toEqual({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7c6' }] })
    expect(eth.calls).toHaveLength(3)
  })

  it('adds QIE mainnet (5 RPCs, explorer) when the wallet does not know the chain (4902)', async () => {
    const w = await load()
    const eth = fakeProvider({
      eth_chainId: '0x1',
      wallet_switchEthereumChain: () => Promise.reject(Object.assign(new Error('unknown chain'), { code: 4902 })),
    })
    window.ethereum = eth
    await w.connect()
    const add = eth.calls[3] as { method: string; params: { chainId: string; rpcUrls: string[]; blockExplorerUrls: string[] }[] }
    expect(add.method).toBe('wallet_addEthereumChain')
    expect(add.params[0]).toMatchObject({ chainId: '0x7c6', chainName: 'QIEMainnet', blockExplorerUrls: ['https://mainnet.qie.digital'] })
    expect(add.params[0].rpcUrls).toHaveLength(5)
  })

  it('passes a rejected chain switch (4001) back to the caller instead of adding the chain', async () => {
    const w = await load()
    const eth = fakeProvider({
      eth_chainId: '0x1',
      wallet_switchEthereumChain: () => Promise.reject(Object.assign(new Error('rejected'), { code: 4001 })),
    })
    window.ethereum = eth
    await expect(w.connect()).rejects.toMatchObject({ code: 4001 })
    expect(eth.calls.map((c) => c.method)).not.toContain('wallet_addEthereumChain')
  })

  it('passes a code-less switch failure back too', async () => {
    const w = await load()
    window.ethereum = fakeProvider({ eth_chainId: '0x1', wallet_switchEthereumChain: () => Promise.reject(null) })
    await expect(w.connect()).rejects.toBeNull()
  })
})

describe('wallet picker (two or more wallets installed)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo='

  it('shows a picker with QIE Wallet first and marked Recommended, and connects the one tapped', async () => {
    const w = await load()
    const mm = fakeProvider()
    const qie = fakeProvider()
    announce(detail('MetaMask', 'io.metamask', mm, 'javascript:alert(1)'))
    announce(detail('QIE Wallet', 'me.qiewallet', qie, PNG))
    const p = w.connect()
    await flush(1)
    const dlg = document.querySelector('dialog.walletsheet')!
    expect(dlg).not.toBeNull()
    const buttons = [...dlg.querySelectorAll<HTMLButtonElement>('.walletbtn')]
    expect(buttons.map((b) => b.querySelector('.walletname')!.textContent)).toEqual(['QIE Wallet', 'MetaMask'])
    expect(buttons[0].querySelector('.recommended')).not.toBeNull()
    expect(buttons[0].querySelector('img')!.getAttribute('src')).toBe(PNG)
    expect(buttons[1].querySelector('img')).toBeNull() // a non-image icon URL is never rendered
    expect(buttons[1].querySelector('.recommended')).toBeNull()
    expect(document.activeElement).toBe(buttons[0])
    buttons[1].click()
    await p
    expect(localStorage.getItem('patungan.wallet')).toBe('io.metamask')
    expect(document.querySelector('dialog')).toBeNull()
    expect((mm as unknown as { calls: unknown[] }).calls.length).toBeGreaterThan(0)
    expect((qie as unknown as { calls: unknown[] }).calls).toHaveLength(0)
  })

  it('marks nobody Recommended when QIE Wallet is not installed', async () => {
    const w = await load()
    announce(detail('MetaMask', 'io.metamask', fakeProvider()))
    announce(detail('Brave Wallet', 'com.brave.wallet', fakeProvider()))
    const p = w.connect()
    await flush(1)
    expect(document.querySelector('.recommended')).toBeNull()
    document.querySelector<HTMLButtonElement>('[data-cancel]')!.click()
    await expect(p).rejects.toThrow('WalletPickCancelled')
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('skips the picker when the remembered wallet is still installed', async () => {
    const w = await load()
    const mm = fakeProvider()
    announce(detail('MetaMask', 'io.metamask', mm))
    announce(detail('QIE Wallet', 'me.qiewallet', fakeProvider()))
    w.chooseWallet('io.metamask')
    await w.connect()
    expect(document.querySelector('dialog')).toBeNull()
    expect((mm as unknown as { calls: unknown[] }).calls.length).toBe(2)
  })

  it('shows the picker again when the remembered wallet was uninstalled', async () => {
    const w = await load()
    announce(detail('MetaMask', 'io.metamask', fakeProvider()))
    announce(detail('QIE Wallet', 'me.qiewallet', fakeProvider()))
    w.chooseWallet('gone.wallet')
    const p = w.connect()
    await flush(1)
    expect(document.querySelector('dialog.walletsheet')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('.walletbtn')!.click()
    await p
    expect(localStorage.getItem('patungan.wallet')).toBe('me.qiewallet')
  })
})

describe('links', () => {
  it('builds a MetaMask in-app browser deep link without the scheme', async () => {
    const w = await load()
    expect(w.metamaskDeepLink('https://patungan.app/p/mainnet-1/7')).toBe('https://metamask.app.link/dapp/patungan.app/p/mainnet-1/7')
    expect(w.QIE_WALLET_URL).toBe('https://qiewallet.me')
  })
})
