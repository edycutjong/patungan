// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Address } from 'viem'
import type { Deployment } from './chain'
import { addr, encodeLog, hash } from './test/logs'

const m = vi.hoisted(() => ({
  loadDeployments: vi.fn(),
  clientFor: vi.fn(),
  connect: vi.fn(),
  hasWallet: vi.fn(),
  walletFor: vi.fn(),
}))
vi.mock('./chain', async (orig) => ({ ...(await orig<typeof import('./chain')>()), loadDeployments: m.loadDeployments, clientFor: m.clientFor }))
vi.mock('./wallet', () => ({ connect: m.connect, hasWallet: m.hasWallet, walletFor: m.walletFor }))

import { renderCreate } from './create'

const MAIN: Deployment = { id: 'mainnet-1', label: 'QIE mainnet', address: '0x2f4646D52a5393E239f5b880411dC2CA2D945F31', deployBlock: 1, chainId: 1990 }
const FORK: Deployment = { ...MAIN, id: 'fork', rpc: 'http://127.0.0.1:8545' }
const ME = '0x616F4e1d85D41F34330D3D0D167717c4015E69D7' as Address
const SELLER = '0xE1b010F148b1B53CcC45291df583B297E0eA93dC' as Address
const NOW = Date.UTC(2026, 10, 14, 0, 0) / 1000 // the form suggests 2026-11-17 20:00 WIB
const TX = hash(0xc0ffee)

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

const createdLog = (address: Address, id = 7n) =>
  encodeLog(address, 'PoolCreated', { id, organizer: ME, payee: SELLER, payeeName: '', price: 2_000_000n, seats: 5, deadline: 1_800_000_000, title: 'x' }, TX, 10n)

function fakeClient(o: { names?: Record<string, Address>; times?: number[] } = {}) {
  const names = o.names ?? { lapangan: SELLER }
  const times = [...(o.times ?? [])]
  return {
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args: [string, string] }) =>
      functionName === 'domainExistsByName' ? args[0] in names : names[args[0]],
    ),
    getBlock: vi.fn(async () => ({ timestamp: BigInt(times.shift() ?? NOW) })),
    simulateContract: vi.fn(async (req: unknown) => ({ request: req })),
    estimateContractGas: vi.fn(async () => 400_000n),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success', logs: [createdLog(MAIN.address)] })),
  }
}

let root: HTMLElement
let client: ReturnType<typeof fakeClient>
let writeContract: ReturnType<typeof vi.fn>

const tick = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!
const input = (name: string) => q<HTMLInputElement>(`[name="${name}"]`)
const type = (name: string, value: string) => {
  const el = input(name)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const err = (k: string) => q(`[data-err="${k}"]`).textContent
const submit = async () => {
  q<HTMLFormElement>('#create').dispatchEvent(new Event('submit', { cancelable: true }))
  await tick()
}

async function open(deps: Deployment[] = [MAIN], c = fakeClient()) {
  client = c
  m.loadDeployments.mockResolvedValue(deps)
  m.clientFor.mockReturnValue(c)
  await renderCreate(root)
  if (input('title')) type('title', 'Futsal') // the form starts with no title
}

const revert = (errorName?: string) => {
  const e = new ContractFunctionRevertedError({ abi: [], functionName: 'createPool' })
  Object.assign(e, { data: errorName ? { errorName } : undefined })
  return e
}

// happy-dom 21 does not match `:not(:empty)` (real browsers do); the form's focusFirstError() uses it, so the test
// environment answers that one selector the way a browser would. Everything else goes to happy-dom unchanged.
const nativeQuerySelector = Element.prototype.querySelector
beforeEach(() => {
  vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (this: Element, sel: string) {
    if (sel === '.err:not(:empty)') return [...this.querySelectorAll('.err')].find((e) => e.childNodes.length > 0) ?? null
    return nativeQuerySelector.call(this, sel)
  })
})

beforeEach(() => {
  vi.useFakeTimers({ now: NOW * 1000 })
  root = document.createElement('main')
  document.body.replaceChildren(root)
  for (const f of Object.values(m)) f.mockReset()
  m.hasWallet.mockReturnValue(true)
  m.connect.mockResolvedValue({ account: ME })
  writeContract = vi.fn(async () => TX)
  m.walletFor.mockReturnValue({ writeContract })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('create form', () => {
  it('suggests a deadline three days out at 20:00 WIB and shows no fork note on mainnet', async () => {
    await open()
    expect(input('date').value).toBe('2026-11-17')
    expect(input('time').value).toBe('20:00')
    expect(root.querySelector('.localnote')).toBeNull()
    expect(q<HTMLButtonElement>('button[type=submit]').disabled).toBe(false)
  })

  it('warns that a local fork is not mainnet', async () => {
    await open([FORK])
    expect(q('.localnote').textContent).toContain('Local test chain')
  })

  it('disables Create and does nothing when the contract is not deployed yet', async () => {
    await open([])
    expect(q('.localnote').textContent).toContain('not deployed on QIE mainnet yet')
    expect(q<HTMLButtonElement>('button[type=submit]').disabled).toBe(true)
    type('payee', 'lapangan.qie')
    await tick(400)
    expect(q('.resolve').textContent).toBe('')
    await submit()
    expect(q('.msg').textContent).toBe('')
    expect(m.connect).not.toHaveBeenCalled()
  })

  it('clears a field error as soon as that field is edited, and the deadline error from either date or time', async () => {
    await open()
    type('title', '')
    await submit()
    expect(err('title')).toContain('Give the pool a name')
    type('title', 'Futsal')
    expect(err('title')).toBe('')
    q('[data-err="deadline"]').textContent = 'x'
    type('time', '21:00')
    expect(err('deadline')).toBe('')
    q('[data-err="deadline"]').textContent = 'x'
    type('date', '2026-11-18')
    expect(err('deadline')).toBe('')
  })
})

describe('payee lookup (debounced, live .qie resolve)', () => {
  it('resolves a registered .qie name to its owner address', async () => {
    await open()
    type('payee', ' @Lapangan.QIE ')
    await tick(349)
    expect(q('.resolve').textContent).toBe('')
    await tick(1)
    expect(q('.resolve').textContent).toBe('✓ lapangan.qie resolves to 0xE1b0…93dC. The money goes to this address, fixed when the pool is created.')
  })

  it('says an unregistered name is not registered', async () => {
    await open()
    type('payee', 'nobody')
    await tick(350)
    expect(q('.resolve').textContent).toBe('✗ nobody.qie is not registered.')
  })

  it('shows "Looking up" while the registry answers', async () => {
    const c = fakeClient()
    c.readContract.mockReturnValue(new Promise(() => {}))
    await open([MAIN], c)
    type('payee', 'lapangan')
    await tick(350)
    expect(q('.resolve').textContent).toBe('Looking up lapangan.qie …')
  })

  it('accepts a plain address with a reminder about QUSDC', async () => {
    await open()
    type('payee', SELLER)
    await tick(350)
    expect(q('.resolve').textContent).toContain('✓ A plain address: 0xE1b0…93dC.')
  })

  it('refuses the zero address and the Patungan contract itself as the seller', async () => {
    await open()
    type('payee', '0x0000000000000000000000000000000000000000')
    await tick(350)
    expect(q('.resolve').textContent).toContain("✗ That address can't be the seller")
    type('payee', MAIN.address.toLowerCase())
    await tick(350)
    expect(q('.resolve').textContent).toContain("✗ That address can't be the seller")
  })

  it('catches a mistyped checksum and junk that is neither a name nor an address', async () => {
    await open()
    type('payee', '0xE1b010F148b1B53CcC45291df583B297E0eA93Dc')
    await tick(350)
    expect(q('.resolve').textContent).toContain("doesn't pass its checksum")
    type('payee', 'bad name!')
    await tick(350)
    expect(q('.resolve').textContent).toBe('✗ Enter a .qie name (letters, digits, hyphens) or a 0x address.')
    type('payee', '   ')
    await tick(350)
    expect(q('.resolve').textContent).toBe('')
  })

  it('says the registry is unreachable when the lookup fails', async () => {
    const c = fakeClient()
    c.readContract.mockRejectedValue(new Error('timeout'))
    await open([MAIN], c)
    type('payee', 'lapangan')
    await tick(350)
    expect(q('.resolve').textContent).toBe("Couldn't reach the QIE name registry. Try again in a moment.")
  })

  it('never lets a slow, older lookup overwrite a newer one (at each await)', async () => {
    const c = fakeClient({ names: { lapangan: SELLER, kedua: ME } })
    await open([MAIN], c)
    const slowExists = deferred<boolean>()
    const slowOwner = deferred<Address>()
    const slowFail = deferred<boolean>()
    const real = c.readContract.getMockImplementation()!
    c.readContract
      .mockImplementationOnce(() => slowExists.promise) // 1st lookup stalls on domainExistsByName
      .mockImplementationOnce(real) // 2nd lookup: exists
      .mockImplementationOnce(() => slowOwner.promise) // 2nd lookup stalls on domainOwnerByName
      .mockImplementationOnce(() => slowFail.promise) // 3rd lookup stalls, then fails
    type('payee', 'lapangan')
    await tick(350)
    type('payee', 'kedua')
    await tick(350)
    type('payee', 'ketiga')
    await tick(350)
    // a 4th, final lookup that wins
    type('payee', 'kedua')
    await tick(350)
    const final = q('.resolve').textContent
    expect(final).toContain('kedua.qie resolves to 0x616F…69D7')
    slowExists.resolve(true)
    slowOwner.resolve(SELLER)
    slowFail.reject(new Error('late failure'))
    await tick()
    expect(q('.resolve').textContent).toBe(final)
  })
})

describe('creating a pool', () => {
  it('validates before opening a wallet and focuses the first bad field', async () => {
    await open()
    type('title', '')
    type('seats', '1')
    type('price', 'free')
    await submit()
    expect(err('title')).toContain('Give the pool a name')
    expect(err('seats')).toBe('Seats must be 2 to 100.')
    expect(err('price')).toContain('price per seat')
    expect(err('payee')).toBe('Enter a .qie name that exists, or a 0x address.')
    expect(document.activeElement).toBe(input('title'))
    expect(m.connect).not.toHaveBeenCalled()
    expect(q<HTMLButtonElement>('button[type=submit]').disabled).toBe(false)
    expect(input('title').disabled).toBe(false)
  })

  it('focuses the date field when only the deadline is wrong (checked against chain time, not the device clock)', async () => {
    await open([MAIN], fakeClient({ times: [Date.UTC(2026, 10, 17, 13, 0) / 1000] }))
    type('payee', 'lapangan')
    await submit()
    expect(err('deadline')).toBe('The deadline must be at least 10 minutes from now.')
    expect(document.activeElement).toBe(input('date'))
  })

  it('does not add a payee error over a lookup that already said what is wrong', async () => {
    await open()
    type('payee', 'nobody')
    await submit()
    expect(q('.resolve').textContent).toBe('✗ nobody.qie is not registered.')
    expect(err('payee')).toBe('')
    expect(m.connect).not.toHaveBeenCalled()
  })

  it('does not add a payee error when the registry was unreachable, and stays put', async () => {
    const c = fakeClient()
    c.readContract.mockRejectedValue(new Error('timeout'))
    await open([MAIN], c)
    type('payee', 'lapangan')
    await submit()
    expect(err('payee')).toBe('')
    expect(q('.resolve').textContent).toContain("Couldn't reach")
    expect(m.connect).not.toHaveBeenCalled()
  })

  it('asks for a wallet app when no wallet is installed', async () => {
    m.hasWallet.mockReturnValue(false)
    await open()
    await submit()
    expect(q('.msg').textContent).toBe('Open this page in a wallet app (QIE Wallet or MetaMask) to create a pool.')
  })

  it('re-checks the deadline on chain time after a slow wallet connect', async () => {
    await open([MAIN], fakeClient({ times: [NOW, Date.UTC(2026, 10, 17, 12, 55) / 1000] }))
    type('payee', 'lapangan')
    await submit()
    expect(m.connect).toHaveBeenCalled()
    expect(err('deadline')).toBe('The deadline must be at least 10 minutes from now.')
    expect(client.simulateContract).not.toHaveBeenCalled()
    expect(input('title').disabled).toBe(false)
  })

  it('creates a pool by .qie name with expectedPayee, pads the gas estimate by 25%, and shows the share sheet', async () => {
    const copy = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true })
    await open()
    type('title', 'Futsal <Kamis>')
    type('payee', 'lapangan.qie')
    await submit()
    const req = client.simulateContract.mock.calls[0][0] as { functionName: string; args: unknown[]; account: Address }
    expect(req.functionName).toBe('createPoolByName')
    expect(req.args).toEqual(['lapangan', SELLER, 2_000_000n, 5, Date.UTC(2026, 10, 17, 13, 0) / 1000, 'Futsal <Kamis>'])
    expect(req.account).toBe(ME)
    expect(writeContract.mock.calls[0][0]).toMatchObject({ gas: 500_000n })
    expect(root.querySelector('#create')).toBeNull() // no second create from a stray tap
    const shared = q('#shared')
    expect(shared.textContent).toContain('✓ Pool #7 created.')
    expect(shared.querySelector('a.tx')!.getAttribute('href')).toBe(`https://mainnet.qie.digital/tx/${TX}`)
    expect(shared.querySelector('.sharetext')!.textContent).toContain('pays lapangan.qie')
    expect(shared.querySelector('.status:nth-of-type(2)')!.innerHTML).toContain('Futsal &lt;Kamis&gt;')
    expect(shared.querySelector('.actions a.cta:not(.ghost)')!.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/)
    const url = `${location.origin}/p/mainnet-1/7`
    expect(shared.querySelector('a.ghost')!.getAttribute('href')).toBe(url)
    shared.querySelector<HTMLButtonElement>('[data-copy]')!.click()
    await tick()
    expect(copy).toHaveBeenCalledWith(url)
    expect(q('#copied').textContent).toBe('Link copied.')
  })

  it('creates a pool to a plain address, and offers the link by hand when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    const c = fakeClient()
    c.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [createdLog(addr(9), 99n), createdLog(FORK.address, 8n)] })
    await open([FORK], c)
    type('payee', SELLER)
    await submit()
    expect((c.simulateContract.mock.calls[0][0] as { functionName: string }).functionName).toBe('createPool')
    expect(q('#shared .sharetext').textContent).toContain('pays 0xE1b0…93dC')
    expect(q('#shared').textContent).toContain('Pool #8 created') // only the log from this deployment counts
    expect(q('#shared span.tx').getAttribute('title')).toBe(TX) // no explorer on a fork
    q<HTMLButtonElement>('[data-copy]').click()
    await tick()
    expect(q('#copied').textContent).toBe(`Copy this link by hand: ${location.origin}/p/fork/8`)
  })

  it('never invites a second create once the tx was sent but could not be confirmed', async () => {
    const c = fakeClient()
    c.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted', logs: [] })
    await open([MAIN], c)
    type('payee', 'lapangan')
    await submit()
    expect(q('.msg').textContent).toContain("Your transaction was sent but we couldn't confirm it.")
    expect(q<HTMLButtonElement>('button[type=submit]').disabled).toBe(true)
    expect(input('title').disabled).toBe(true)
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    q<HTMLButtonElement>('[data-reload]').click()
    expect(reload).toHaveBeenCalled()
  })

  it('treats a mined receipt without this contract\'s PoolCreated event as unconfirmed', async () => {
    const c = fakeClient()
    c.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [createdLog(addr(9))] })
    await open([MAIN], c)
    type('payee', 'lapangan')
    await submit()
    expect(q('.msg').textContent).toContain('sent but we couldn')
  })

  describe('says in plain words why a create failed, then unlocks the form', () => {
    const cases: [string, unknown, string][] = [
      ['wallet picker cancelled', new Error('WalletPickCancelled'), 'No wallet chosen. Nothing was sent.'],
      ['rejected in the wallet', new BaseError('x', { cause: new UserRejectedRequestError(new Error('no')) }), 'You cancelled in the wallet. Nothing was sent.'],
      ['name not registered', revert('PayeeNotFound'), "That .qie name isn't registered."],
      ['name moved before mining', revert('PayeeChanged'), 'That .qie name just moved to another owner. Check the address shown and try again.'],
      ['payee rejected', revert('PayeeInvalid'), "That address can't be the payee."],
      ['bad params', revert('BadParams'), 'The contract rejected these values: check seats (2–100), the price, the title length and the deadline (10 minutes to 90 days from now).'],
      ['unknown revert', revert('Insolvent'), 'Could not create the pool. Nothing moved except, if it was mined, the network fee.'],
      ['revert without data', revert(), 'Could not create the pool. Nothing moved except, if it was mined, the network fee.'],
      ['other viem error', new BaseError('rpc'), 'Could not create the pool. Nothing moved except, if it was mined, the network fee.'],
      ['anything else', new Error('boom'), 'Could not create the pool. Nothing moved except, if it was mined, the network fee.'],
      ['the write code failing to download', new Error('AppNotLoaded'), "Part of the app didn't download, so nothing was sent. Check the connection and reload the page."],
    ]
    it.each(cases)('%s', async (_name, error, sentence) => {
      const c = fakeClient()
      if (error instanceof Error && error.message === 'WalletPickCancelled') m.connect.mockRejectedValue(error)
      else c.simulateContract.mockRejectedValue(error)
      await open([MAIN], c)
      type('payee', 'lapangan')
      await submit()
      expect(q('.msg').textContent).toBe(sentence)
      expect(q<HTMLButtonElement>('button[type=submit]').disabled).toBe(false)
      expect(input('payee').disabled).toBe(false)
    })
  })
})
