// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Address, type Hash } from 'viem'
import type { Deployment } from './chain'
import { addr, flush, hash } from './test/logs'

const m = vi.hoisted(() => ({
  loadDeployments: vi.fn(),
  clientFor: vi.fn(),
  connect: vi.fn(),
  forgetWallet: vi.fn(),
  hasWallet: vi.fn(),
  provider: vi.fn(),
  walletFor: vi.fn(),
  wallets: vi.fn(),
}))
vi.mock('./chain', async (orig) => ({ ...(await orig<typeof import('./chain')>()), loadDeployments: m.loadDeployments, clientFor: m.clientFor }))
vi.mock('./wallet', async (orig) => {
  const real = await orig<typeof import('./wallet')>()
  return {
    QIE_WALLET_URL: real.QIE_WALLET_URL,
    metamaskDeepLink: real.metamaskDeepLink,
    connect: m.connect,
    forgetWallet: m.forgetWallet,
    hasWallet: m.hasWallet,
    provider: m.provider,
    walletFor: m.walletFor,
    wallets: m.wallets,
  }
})

import { ADDR } from './chain'
import { renderPool } from './pool'

// ------------------------------------------------------------------ fixtures
const MAIN: Deployment = {
  id: 'mainnet-1',
  label: 'QIE mainnet',
  address: '0x2f4646D52a5393E239f5b880411dC2CA2D945F31',
  deployBlock: 1_000,
  chainId: 1990,
  builderWallets: ['0x31EcaaF66b8837d600DDBDd833e2B2Ef370DaC70'],
}
const FORK: Deployment = { ...MAIN, id: 'fork', label: 'Fork', rpc: 'http://127.0.0.1:8545', builderWallets: undefined }
const ORG = '0x616F4e1d85D41F34330D3D0D167717c4015E69D7' as Address
const ALICE = '0xc7Fe0a5628c945D0f98594EDA770814BF9Ac4BA1' as Address
const BOB = '0xE1b010F148b1B53CcC45291df583B297E0eA93dC' as Address
const BUILDER = '0x31EcaaF66b8837d600DDBDd833e2B2Ef370DaC70' as Address
const SELLER = '0x3e015c14AE36d81d73ACda34713122CC90Ec3cf7' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const TS = 1_800_000_000
const PRICE = 2_000_000n
const QIE = 10n ** 18n

interface Member {
  addr: Address
  seats: number
  owed: bigint
}
interface Ev {
  member?: Address
  n?: number
  qie?: boolean
  tx: Hash
  block: bigint
}
interface State {
  block: bigint
  ts: number
  organizer: Address
  payee: Address
  price: bigint
  deadline: number
  seats: number
  filled: number
  status: number
  title: string
  payeeName: string
  refunded: number
  refundable: boolean
  members: Member[]
  solvent: boolean
  balance: bigint
  allowance: bigint
  quote: [bigint, bigint, bigint]
  oracleUpdatedAt: bigint
  maxDevBps: bigint
  joined: Ev[]
  paid: Ev[]
  refunds: Ev[]
}

const baseState = (o: Partial<State> = {}): State => ({
  block: 2_000n,
  ts: TS,
  organizer: ORG,
  payee: SELLER,
  price: PRICE,
  deadline: TS + 86_400,
  seats: 5,
  filled: 2,
  status: 0,
  title: 'Futsal Kamis',
  payeeName: 'lapangan',
  refunded: 0,
  refundable: false,
  members: [
    { addr: ALICE, seats: 1, owed: PRICE },
    { addr: BUILDER, seats: 1, owed: PRICE },
  ],
  solvent: true,
  balance: 0n,
  allowance: 0n,
  quote: [2n * QIE, 0n, 3n * QIE],
  oracleUpdatedAt: BigInt(TS - 7_200),
  maxDevBps: 1500n,
  joined: [],
  paid: [],
  refunds: [],
  ...o,
})

/** A fake viem public client that answers from `st`, which tests mutate between polls. */
function fakeClient(st: State) {
  const inRange = (e: Ev, from: bigint, to: bigint) => e.block >= from && e.block <= to
  return {
    getBlock: vi.fn(async () => ({ number: st.block, timestamp: BigInt(st.ts) })),
    getBlockNumber: vi.fn(async () => st.block),
    readContract: vi.fn(async ({ functionName }: { functionName: string; args?: unknown[] }) => {
      switch (functionName) {
        case 'maxDevBps':
          return st.maxDevBps
        case 'getPool':
          return [
            { organizer: st.organizer, payee: st.payee, price: st.price, deadline: st.deadline, seats: st.seats, filled: st.filled, status: st.status, held: 0n },
            st.title,
            st.payeeName,
            BigInt(st.members.length),
            BigInt(st.refunded),
            st.refundable,
          ]
        case 'getMembers':
          return [st.members.map((x) => x.addr), st.members.map((x) => x.seats), st.members.map((x) => x.owed)]
        case 'isSolvent':
          return st.solvent
        case 'balanceOf':
          return st.balance
        case 'allowance':
          return st.allowance
        case 'quoteQIE':
          return st.quote
        case 'latestRoundData':
          return [1n, 12_340_000n, 0n, st.oracleUpdatedAt, 1n]
      }
      throw new Error(`unexpected read ${functionName}`)
    }),
    getContractEvents: vi.fn(async ({ eventName, fromBlock, toBlock }: { eventName: string; fromBlock: bigint; toBlock: bigint }) => {
      const list = eventName === 'Joined' ? st.joined : eventName === 'PoolPaid' ? st.paid : st.refunds
      return list
        .filter((e) => inRange(e, fromBlock, toBlock))
        .map((e) => ({ args: { member: e.member, n: e.n, paidWithQIE: e.qie }, transactionHash: e.tx, blockNumber: e.block }))
    }),
    simulateContract: vi.fn(async (call: unknown) => ({ request: call })),
    estimateContractGas: vi.fn(async () => 300_000n),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success' })),
  }
}
type Client = ReturnType<typeof fakeClient>

function fakeProvider(accounts: Address[] = [], withEvents = true) {
  const handlers: Record<string, (x: never) => void> = {}
  return {
    request: vi.fn(async () => accounts),
    on: withEvents ? vi.fn((ev: string, h: (x: never) => void) => void (handlers[ev] = h)) : undefined,
    handlers,
  }
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

const revert = (o: { errorName?: string; reason?: string }) => {
  const e = new ContractFunctionRevertedError({ abi: [], functionName: 'join' })
  Object.assign(e, { data: o.errorName ? { errorName: o.errorName } : undefined, reason: o.reason })
  return e
}
const rejected = () => new BaseError('x', { cause: new UserRejectedRequestError(new Error('no')) })

// ------------------------------------------------------------------ harness
let root: HTMLElement
let st: State
let client: Client
let poll: () => void
let wallet: { writeContract: ReturnType<typeof vi.fn>; sendTransaction: ReturnType<typeof vi.fn> }

async function open(o: { state?: Partial<State>; dep?: Deployment; account?: Address; installed?: boolean; provider?: ReturnType<typeof fakeProvider>; nWallets?: number; id?: bigint } = {}) {
  document.querySelectorAll('dialog').forEach((d) => d.remove()) // a previous page's join sheet
  st = baseState(o.state)
  client = fakeClient(st)
  m.loadDeployments.mockResolvedValue([o.dep ?? MAIN])
  m.clientFor.mockReturnValue(client)
  const installed = o.installed ?? true
  m.hasWallet.mockReturnValue(installed)
  m.provider.mockReturnValue(installed ? (o.provider ?? fakeProvider(o.account ? [o.account] : [])) : undefined)
  m.wallets.mockReturnValue(Array.from({ length: o.nWallets ?? 1 }))
  m.connect.mockResolvedValue({ account: o.account ?? ALICE })
  await renderPool(root, (o.dep ?? MAIN).id, o.id ?? 7n)
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)
const sheet = () => document.querySelector<HTMLDialogElement>('dialog.joinsheet')!
const inSheet = <T extends Element = HTMLButtonElement>(sel: string) => sheet().querySelector<T>(sel)
const act = async (name: string) => {
  $<HTMLButtonElement>(`[data-act="${name}"]`)!.click()
  await flush()
}
const rosterTicks = () => [...root.querySelectorAll('.roster .tick')].map((t) => t.textContent)

beforeEach(() => {
  root = document.createElement('main')
  document.body.replaceChildren(root)
  for (const f of Object.values(m)) f.mockReset()
  wallet = { writeContract: vi.fn(async () => hash(0xaa)), sendTransaction: vi.fn(async () => hash(0xbb)) }
  m.walletFor.mockReturnValue(wallet)
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void) => {
    poll = fn
    return 0
  }) as never)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

// ------------------------------------------------------------------ tests
describe('pool page: loading', () => {
  it('says the deployment is unknown for a bad deployment id', async () => {
    m.loadDeployments.mockResolvedValue([MAIN])
    await renderPool(root, 'nope<x>', 1n)
    expect(root.querySelector('h1')!.textContent).toBe('Unknown deployment')
    expect(root.innerHTML).toContain('nope&lt;x&gt;')
  })

  it('says the pool does not exist when getPool returns an empty organizer', async () => {
    await open({ state: { organizer: ZERO } })
    expect(root.querySelector('h1')!.textContent).toBe('Pool #7 not found')
  })

  it('says the RPCs are not answering while the first read fails, then paints the receipt on a later poll', async () => {
    st = baseState()
    client = fakeClient(st)
    client.getBlock.mockRejectedValueOnce(new Error('down'))
    client.readContract.mockRejectedValueOnce(new Error('down')) // maxDevBps
    m.loadDeployments.mockResolvedValue([MAIN])
    m.clientFor.mockReturnValue(client)
    m.hasWallet.mockReturnValue(false)
    await renderPool(root, 'mainnet-1', 7n)
    await flush()
    expect(root.querySelector('.ghosttext')).not.toBeNull()
    expect(console.warn).toHaveBeenCalled()
    poll()
    await flush()
    expect(root.querySelector('h1')!.textContent).toBe('Futsal Kamis')
    // a later failed poll leaves the painted receipt alone
    client.getBlock.mockRejectedValueOnce(new Error('down'))
    poll()
    await flush()
    expect(root.querySelector('h1')!.textContent).toBe('Futsal Kamis')
  })

  it('shows the receipt: title, .qie payee with address, amount in words, deadline, status line, contract link', async () => {
    await open()
    expect($('h1')!.textContent).toBe('Futsal Kamis')
    expect($('.payee')!.textContent).toContain('lapangan.qie')
    expect($('.payee .data')!.textContent).toBe('0x3e01…3cf7')
    expect($('.amount')!.textContent).toContain('2.00 QUSDC')
    expect($('.amount small')!.textContent).toContain('10.00 QUSDC in total')
    expect($('.counter')!.getAttribute('aria-label')).toBe('2 of 5 seats paid')
    expect($('.inwords')!.textContent).toContain('two point zero zero QUSDC per seat')
    expect($('.deadline')!.textContent).toMatch(/closes .* WIB · 1 d 0 h left|closes .* WIB · 23 h/)
    expect($('.status')!.textContent).toContain('2 of 5 seats paid')
    expect($('footer a')!.getAttribute('href')).toBe(`https://mainnet.qie.digital/address/${MAIN.address}`)
    expect($('footer')!.textContent).toContain('organizer 0x616F…69D7')
    expect($('.localnote')).toBeNull()
    expect($('article')!.hasAttribute('aria-busy')).toBe(false)
  })

  it('names an untitled pool by its number and shows a plain payee address', async () => {
    await open({ state: { title: '', payeeName: '' } })
    expect($('h1')!.textContent).toBe('Pool #7')
    expect($('.payee')!.textContent!.trim()).toBe('0x3e01…3cf7')
  })

  it('marks a local fork as test data and links nothing to an explorer', async () => {
    await open({ dep: FORK, state: { joined: [{ member: ALICE, n: 1, tx: hash(1), block: 1_500n }] } })
    expect($('.localnote')!.textContent).toContain('Local test chain')
    expect($('footer a')).toBeNull()
    expect($('.roster span.tx')!.getAttribute('title')).toBe(hash(1))
    expect($('.tag.builder')).toBeNull()
  })
})

describe('pool page: roster', () => {
  it('draws one row per seat with join tx links, a "paid in QIE" tag, the builder wallet label and open seats', async () => {
    await open({
      account: BOB,
      state: {
        filled: 4,
        members: [
          { addr: ALICE, seats: 2, owed: 2n * PRICE },
          { addr: BUILDER, seats: 1, owed: PRICE },
          { addr: BOB, seats: 1, owed: PRICE },
        ],
        joined: [
          { member: ALICE, n: 2, qie: true, tx: hash(1), block: 1_500n },
          { member: BUILDER, n: 1, qie: false, tx: hash(2), block: 1_600n },
        ],
      },
    })
    const rows = [...root.querySelectorAll('.roster li')]
    expect(rows).toHaveLength(5)
    expect(rows[0].querySelector('a.tx')!.getAttribute('href')).toBe(`https://mainnet.qie.digital/tx/${hash(1)}`)
    expect(rows[1].querySelector('a.tx')).toBeNull() // second seat of the same join: no repeated link
    expect(rows[0].querySelector('.tag')!.textContent).toBe('paid in QIE')
    expect(rows[1].querySelector('.tag')!.textContent).toBe('paid in QIE')
    expect(rows[2].querySelector('.tag.builder')!.textContent).toBe('builder wallet')
    expect(rows[2].textContent).not.toContain('paid in QIE')
    expect(rows[3].textContent).toContain('(you)') // BOB has no join log yet: no link, no tag
    expect(rows[3].querySelector('.tx')).toBeNull()
    expect(rows[4].className).toBe('empty')
    expect(rows[4].textContent).toContain('open seat')
    expect(rosterTicks().slice(0, 4)).toEqual(['HELD', 'HELD', 'HELD', 'HELD'])
  })

  it('says tx links are unavailable when the RPC refuses the log query, and drops the note once logs load', async () => {
    st = baseState()
    await open()
    expect($('.roster')!.textContent).toBeTruthy()
    client.getBlockNumber.mockRejectedValueOnce(new Error('range too large'))
    for (let i = 0; i < 5; i++) poll()
    await flush()
    expect(root.textContent).toContain('Transaction links unavailable right now')
    for (let i = 0; i < 5; i++) poll()
    await flush()
    expect(root.textContent).not.toContain('Transaction links unavailable right now')
  })

  it('scans logs in 10,000-block chunks from the deploy block, then only the new blocks, without double-counting', async () => {
    await open({ state: { block: 25_000n, joined: [{ member: ALICE, n: 1, tx: hash(1), block: 12_000n }] } })
    const ranges = client.getContractEvents.mock.calls.filter((c) => c[0].eventName === 'Joined').map((c) => [c[0].fromBlock, c[0].toBlock])
    expect(ranges).toEqual([
      [1_000n, 10_999n],
      [11_000n, 20_999n],
      [21_000n, 25_000n],
    ])
    st.block = 25_010n
    st.joined.push({ member: BOB, n: 1, tx: hash(2), block: 25_005n })
    st.members.push({ addr: BOB, seats: 1, owed: PRICE })
    for (let i = 0; i < 5; i++) poll()
    await flush()
    const last = client.getContractEvents.mock.calls.at(-1)![0]
    expect([last.fromBlock, last.toBlock]).toEqual([25_001n, 25_010n])
    expect(root.querySelectorAll('.roster a.tx')).toHaveLength(2)
  })

  it('never stacks log scans: a poll during a scan queues exactly one more scan', async () => {
    await open()
    const slow = deferred<bigint>()
    client.getBlockNumber.mockReturnValueOnce(slow.promise)
    const before = client.getBlockNumber.mock.calls.length
    for (let i = 0; i < 10; i++) poll() // two activity loads requested; the second must wait
    await flush()
    expect(client.getBlockNumber.mock.calls.length).toBe(before + 1)
    slow.resolve(st.block)
    await flush()
    expect(client.getBlockNumber.mock.calls.length).toBe(before + 2)
  })

  it('never lets an older, slower read paint over a newer one', async () => {
    await open()
    const slowBlock = deferred<{ number: bigint; timestamp: bigint }>()
    client.getBlock.mockReturnValueOnce(slowBlock.promise)
    poll() // stalls on block 2000
    st.block = 2_001n
    st.filled = 3
    st.members.push({ addr: BOB, seats: 1, owed: PRICE })
    poll()
    await flush()
    expect($('.counter')!.textContent).toBe('3/5')
    st.filled = 2
    st.members.pop()
    slowBlock.resolve({ number: 1_999n, timestamp: BigInt(TS) })
    await flush()
    expect($('.counter')!.textContent).toBe('3/5')
  })
})

describe('pool page: stamps', () => {
  it('shows the PAID IN FULL stamp with the payout tx when all seats are paid', async () => {
    await open({
      state: {
        status: 1,
        filled: 5,
        members: [{ addr: ALICE, seats: 5, owed: 0n }],
        paid: [
          { tx: hash(9), block: 1_900n },
          { tx: hash(10), block: 1_950n },
        ],
      },
    })
    expect($('.stamp.paidfull')!.textContent).toContain('PAID')
    expect($('.stamp.land')).toBeNull() // no landing animation on first paint
    expect($('.paidline')!.textContent).toContain('Paid in full: 10.00 QUSDC to lapangan.qie')
    expect($('.paidline a')!.getAttribute('href')).toBe(`https://mainnet.qie.digital/tx/${hash(9)}`)
    expect(rosterTicks()).toEqual(['PAID', 'PAID', 'PAID', 'PAID', 'PAID'])
    expect($('.actions')!.textContent).toBe('')
  })

  it('lands the PAID stamp when the last seat is paid while the page is open', async () => {
    await open()
    st.status = 1
    st.filled = 5
    poll()
    await flush()
    expect($('.stamp.paidfull.land')).not.toBeNull()
  })

  it('lands the REFUNDED stamp when the last refund arrives, counting members in the plural', async () => {
    await open({ state: { refundable: true, refunded: 1, deadline: TS - 10 } })
    expect($('.stamp')).toBeNull()
    st.refunded = 2
    st.members = st.members.map((x) => ({ ...x, owed: 0n }))
    poll()
    await flush()
    expect($('.stamp.refunded.land')).not.toBeNull()
    expect($('.paidline')!.textContent).toContain('Everyone was refunded: 2 members, 4.00 QUSDC')
  })

  it('says "1 member" on a REFUNDED stamp for a single member', async () => {
    await open({ state: { refundable: true, refunded: 1, filled: 1, deadline: TS - 10, members: [{ addr: ALICE, seats: 1, owed: 0n }] } })
    expect($('.paidline')!.textContent).toContain('1 member, 2.00 QUSDC')
  })

  it('shows the CANCELLED stamp for a pool cancelled before anyone joined', async () => {
    await open({ state: { status: 2, refundable: true, filled: 0, members: [] } })
    expect($('.stamp.cancelled')!.textContent).toBe('CANCELLED')
    expect(root.querySelectorAll('.roster li.empty')).toHaveLength(5)
  })
})

describe('pool page: actions', () => {
  it('offers Join and an "Open in wallet app" link to a visitor without a wallet', async () => {
    await open({ installed: false })
    expect($('[data-act="open-sheet"]')!.textContent).toBe('Join · pay 2.00 QUSDC per seat')
    expect($('[data-act="connect"]')).toBeNull()
    expect($<HTMLAnchorElement>('.actions a')!.getAttribute('href')).toMatch(/^https:\/\/metamask\.app\.link\/dapp\//)
  })

  it('pauses Join with the insolvency sentence while the escrow is short', async () => {
    await open({ state: { solvent: false } })
    expect($('[data-act="open-sheet"]')).toBeNull()
    expect($('.actions .note')!.textContent).toContain('New seats are paused')
  })

  it('hides refund buttons before the deadline and shows them once refunds open', async () => {
    await open({ account: ALICE })
    expect($('[data-act="claim"]')).toBeNull()
    expect($('[data-act="refund-all"]')).toBeNull()
    st.refundable = true
    st.deadline = TS - 1
    poll()
    await flush()
    expect($('[data-act="claim"]')!.textContent).toBe('Get my money back · 2.00 QUSDC')
    expect($('[data-act="refund-all"]')!.textContent).toBe('Refund everyone (2 left)')
    expect($('[data-act="open-sheet"]')).toBeNull()
  })

  it('offers only "Refund everyone" to a wallet that is not a member, or whose refund is already out', async () => {
    await open({ account: BOB, state: { refundable: true, deadline: TS - 1 } })
    expect($('[data-act="claim"]')).toBeNull()
    expect($('[data-act="refund-all"]')).not.toBeNull()
    await open({ account: ALICE, state: { refundable: true, refunded: 1, deadline: TS - 1, members: [{ addr: ALICE, seats: 1, owed: 0n }, { addr: BOB, seats: 1, owed: PRICE }], refunds: [{ member: ALICE, tx: hash(5), block: 1_800n }] } })
    expect($('[data-act="claim"]')).toBeNull()
    expect($('[data-act="refund-all"]')!.textContent).toBe('Refund everyone (1 left)')
    expect(rosterTicks()[0]).toBe('REFUNDED')
    expect(root.querySelector('.roster li.refunded a.tx')!.textContent).toBe('refund tx')
    expect(rosterTicks()[1]).toBe('HELD')
  })

  it('links a multi-seat refund once, on the first seat', async () => {
    await open({ state: { refundable: true, refunded: 1, deadline: TS - 1, members: [{ addr: ALICE, seats: 2, owed: 0n }], refunds: [{ member: ALICE, tx: hash(5), block: 1_800n }] } })
    const rows = root.querySelectorAll('.roster li.refunded')
    expect(rows[0].querySelector('a.tx')).not.toBeNull()
    expect(rows[1].querySelector('a.tx')).toBeNull()
  })

  it('claims a refund: simulate, sign with the estimate + 25%, wait, then show a success line', async () => {
    await open({ account: ALICE, state: { refundable: true, deadline: TS - 1 } })
    await act('claim')
    expect(client.simulateContract.mock.calls[0][0]).toMatchObject({ functionName: 'claimRefund', args: [7n], account: ALICE })
    expect(wallet.writeContract.mock.calls[0][0]).toMatchObject({ gas: 375_000n })
    expect($('.msg')!.textContent).toContain('✓ Refund sent.')
    expect($('.msg a.tx')!.getAttribute('href')).toBe(`https://mainnet.qie.digital/tx/${hash(0xaa)}`)
  })

  it('refunds everyone in chunks of 25 members', async () => {
    const members = Array.from({ length: 30 }, (_, i) => ({ addr: addr(i + 100), seats: 1, owed: PRICE }))
    await open({ state: { refundable: true, deadline: TS - 1, seats: 30, filled: 30, members } })
    await act('refund-all')
    expect(client.simulateContract.mock.calls.map((c) => (c[0] as { args: unknown[] }).args)).toEqual([
      [7n, 0n, 25n],
      [7n, 25n, 25n],
    ])
    expect($('.msg')!.textContent).toContain('✓ Refunds sent.')
  })

  it('lets the organizer cancel an open pool', async () => {
    await open({ account: ORG })
    await act('cancel')
    expect(client.simulateContract.mock.calls[0][0]).toMatchObject({ functionName: 'cancel', args: [7n] })
    expect($('.msg')!.textContent).toContain('✓ Pool cancelled.')
  })

  it('disables buttons and ignores taps while a transaction is in flight', async () => {
    await open({ account: ORG })
    const receipt = deferred<{ status: string }>()
    client.waitForTransactionReceipt.mockReturnValueOnce(receipt.promise)
    await act('cancel')
    expect($<HTMLButtonElement>('[data-act="cancel"]')!.disabled).toBe(true)
    expect($('.msg')!.textContent).toContain('Sent, waiting for a QIE block')
    $<HTMLButtonElement>('[data-act="cancel"]')!.click()
    await flush()
    expect(client.simulateContract).toHaveBeenCalledTimes(1)
    receipt.resolve({ status: 'success' })
    await flush()
    expect($<HTMLButtonElement>('[data-act="cancel"]')!.disabled).toBe(false)
  })

  it('ignores "Switch wallet" while a transaction is in flight', async () => {
    await open({ account: ORG, nWallets: 2 })
    const receipt = deferred<{ status: string }>()
    client.waitForTransactionReceipt.mockReturnValueOnce(receipt.promise)
    await act('cancel')
    await act('switch-wallet') // this header button is not disabled while busy
    expect(m.forgetWallet).not.toHaveBeenCalled()
    receipt.resolve({ status: 'success' })
    await flush()
  })

  it('connects a wallet from the header and marks the member row as yours', async () => {
    await open({ account: undefined })
    expect($('.acct')).toBeNull()
    m.connect.mockResolvedValue({ account: ALICE })
    await act('connect')
    expect($('.acct')!.textContent).toBe('0xc7Fe…4BA1')
    expect($('.roster')!.textContent).toContain('(you)')
    expect($('[data-act="switch-wallet"]')).toBeNull() // one wallet installed
  })

  it('switches wallet: forgets the remembered choice and connects again', async () => {
    await open({ account: ALICE, nWallets: 2 })
    m.connect.mockResolvedValue({ account: BOB })
    await act('switch-wallet')
    expect(m.forgetWallet).toHaveBeenCalled()
    expect($('.acct')!.textContent).toBe('0xE1b0…93dC')
  })

  it('follows account changes and disconnects on an empty account list (QIE Wallet), and reloads on a chain change', async () => {
    const p = fakeProvider([ALICE])
    await open({ provider: p })
    expect($('.acct')!.textContent).toBe('0xc7Fe…4BA1')
    p.handlers.accountsChanged([BOB] as never)
    await flush()
    expect($('.acct')!.textContent).toBe('0xE1b0…93dC')
    p.handlers.accountsChanged([] as never)
    await flush()
    expect($('.acct')).toBeNull()
    expect($('[data-act="connect"]')).not.toBeNull()
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    p.handlers.chainChanged(undefined as never)
    expect(reload).toHaveBeenCalled()
  })

  it('works with a provider that has no event API and one whose eth_accounts fails', async () => {
    await open({ provider: fakeProvider([ALICE], false) })
    expect($('.acct')!.textContent).toBe('0xc7Fe…4BA1')
    const p = fakeProvider([])
    p.request.mockRejectedValue(new Error('locked'))
    await open({ provider: p })
    expect($('.acct')).toBeNull()
  })

  describe('says in plain words why a transaction failed', () => {
    const cases: [string, unknown, string][] = [
      ['a named revert', revert({ errorName: 'NothingToRefund' }), 'This wallet has nothing to refund in this pool.'],
      ['a QIEDEX router string revert', revert({ reason: 'UniswapV2Router: EXCESSIVE_INPUT_AMOUNT' }), "QIEDEX's price is more than 15% off the QIE Oracle right now"],
      ['an unknown string revert', revert({ reason: 'weird' }), 'The transaction failed.'],
      ['a revert without data', revert({}), 'The transaction failed.'],
      ['a viem error without a revert', new BaseError('rpc'), 'The transaction failed.'],
      ['a rejection in the wallet', rejected(), 'You cancelled in the wallet. Nothing was sent.'],
      ['a mined but reverted tx', 'receipt-reverted', 'The transaction failed.'],
      ['anything else', new Error('boom'), 'The transaction failed.'],
    ]
    it.each(cases)('%s', async (_n, error, sentence) => {
      await open({ account: ALICE, state: { refundable: true, deadline: TS - 1 } })
      if (error === 'receipt-reverted') client.waitForTransactionReceipt.mockResolvedValueOnce({ status: 'reverted' })
      else client.simulateContract.mockRejectedValueOnce(error)
      await act('claim')
      expect($('.msg')!.textContent).toContain(sentence)
      expect($<HTMLButtonElement>('[data-act="claim"]')!.disabled).toBe(false)
    })
  })

  it('opens the "needs a wallet" sheet when a tap finds no wallet', async () => {
    await open({ account: ALICE, state: { refundable: true, deadline: TS - 1 } })
    m.connect.mockRejectedValueOnce(new Error('NoWallet'))
    m.hasWallet.mockReturnValue(false)
    await act('claim')
    expect(sheet().open).toBe(true)
    expect(sheet().textContent).toContain('Paying needs a wallet on QIE mainnet')
  })

  it('does nothing visible when the wallet picker is cancelled', async () => {
    await open({ account: ALICE, state: { refundable: true, deadline: TS - 1 } })
    m.connect.mockRejectedValueOnce(new Error('WalletPickCancelled'))
    await act('claim')
    expect($('.msg')!.textContent).toBe('')
  })
})

describe('organizer gas drip (0.02 QIE)', () => {
  const drip = () => root.querySelector<HTMLElement>('#drip')
  const send = async (to: string) => {
    drip()!.querySelector('input')!.value = to
    drip()!.querySelector('button')!.click()
    await flush()
    return drip()!.querySelector('.msg')!.textContent
  }

  it('shows the drip box to the organizer only while the pool is open, outside the repainted card', async () => {
    await open({ account: ALICE })
    expect(drip()).toBeNull()
    await open({ account: ORG })
    const box = drip()!
    expect(box.previousElementSibling!.id).toBe('card')
    poll()
    await flush()
    expect(drip()).toBe(box) // a repaint keeps what is being typed
    st.status = 1
    st.filled = 5
    poll()
    await flush()
    expect(drip()).toBeNull()
  })

  it('refuses the zero address, the contract and the organizer, and explains a bad checksum or junk', async () => {
    await open({ account: ORG })
    expect(await send(ZERO)).toContain("That address can't receive gas from here")
    expect(await send(MAIN.address)).toContain("That address can't receive gas from here")
    expect(await send(ORG.toLowerCase())).toContain("That address can't receive gas from here")
    expect(await send('0xE1b010F148b1B53CcC45291df583B297E0eA93Dc')).toContain("doesn't pass its checksum")
    expect(await send('bob')).toBe("Paste the member's 0x address (42 characters).")
    expect(wallet.sendTransaction).not.toHaveBeenCalled()
  })

  it('sends 0.02 QIE to a member and links the tx', async () => {
    await open({ account: ORG })
    m.connect.mockResolvedValue({ account: ORG })
    expect(await send(` ${BOB} `)).toContain('✓ Sent 0.02 QIE for gas to 0xE1b0…93dC.')
    expect(wallet.sendTransaction).toHaveBeenCalledWith({ to: BOB, value: 20_000_000_000_000_000n })
    expect(drip()!.querySelector('button')!.disabled).toBe(false)
  })

  it('reports a reverted transfer', async () => {
    await open({ account: ORG })
    m.connect.mockResolvedValue({ account: ORG })
    client.waitForTransactionReceipt.mockResolvedValueOnce({ status: 'reverted' })
    expect(await send(BOB)).toBe('The transfer reverted.')
  })

  it('refuses when the wallet that signs is not the organizer', async () => {
    await open({ account: ORG })
    m.connect.mockResolvedValue({ account: ALICE })
    expect(await send(BOB)).toBe("The connected wallet is not this pool's organizer. Switch to the organizer wallet.")
  })

  it('says a wallet rejection sent nothing, and any other failure moved nothing but the fee', async () => {
    await open({ account: ORG })
    m.connect.mockResolvedValue({ account: ORG })
    wallet.sendTransaction.mockRejectedValueOnce(rejected())
    expect(await send(BOB)).toBe('You cancelled in the wallet. Nothing was sent.')
    wallet.sendTransaction.mockRejectedValueOnce(new BaseError('rpc'))
    expect(await send(BOB)).toBe('Could not send the QIE. Nothing moved except, if it was mined, the network fee.')
  })
})

describe('join sheet', () => {
  const openSheet = async () => {
    await act('open-sheet')
    return sheet()
  }
  const tabBody = () => inSheet<HTMLElement>('.tabbody')!.textContent!

  it('explains both ways to get a wallet when none is installed', async () => {
    await open({ installed: false })
    const s = await openSheet()
    expect(s.open).toBe(true)
    expect(s.querySelector('a[href="https://qiewallet.me"]')).not.toBeNull()
    expect(s.querySelector<HTMLAnchorElement>('.ways a')!.getAttribute('href')).toMatch(/^https:\/\/metamask\.app\.link/)
  })

  it('defaults to Pay with QIE and shows the quote, the 1% max and the Oracle guard', async () => {
    await open({ account: ALICE })
    await openSheet()
    expect(inSheet('[data-tab="qie"]')!.getAttribute('aria-selected')).toBe('true')
    expect(tabBody()).toContain('≈ 2.0000 QIE (QIEDEX quote) · your max 2.0200 QIE: 1% over this quote.')
    expect(tabBody()).toContain('The QIE Oracle guard (15%) is the hard cap: 3.0000 QIE. Oracle price updated 2 h ago.')
  })

  it('says the max is the Oracle cap when the cap cuts the 1% short', async () => {
    await open({ account: ALICE, state: { quote: [2n * QIE, 0n, 2n * QIE + 1n] } })
    await openSheet()
    expect(tabBody()).toContain("the Oracle guard's cap, less than 1% over this quote.")
  })

  it('offers no QIE payment when QIEDEX is outside the Oracle guard', async () => {
    await open({ account: ALICE, state: { quote: [4n * QIE, 0n, 3n * QIE] } })
    await openSheet()
    expect(tabBody()).toContain('more than 15% off the QIE Oracle right now')
    expect(inSheet('[data-pay="qie"]')).toBeNull()
  })

  it('reads the deployed Oracle guard if the first read failed', async () => {
    st = baseState()
    await open({ account: ALICE })
    expect(client.readContract.mock.calls.filter((c) => c[0].functionName === 'maxDevBps')).toHaveLength(1)
    // second open: guard already read, never re-read
    await openSheet()
    expect(client.readContract.mock.calls.filter((c) => c[0].functionName === 'maxDevBps')).toHaveLength(1)
  })

  it('re-reads the guard on the QIE tab when it failed at page load', async () => {
    st = baseState()
    client = fakeClient(st)
    const real = client.readContract.getMockImplementation()!
    client.readContract.mockImplementationOnce(() => Promise.reject(new Error('down'))).mockImplementation(real)
    m.loadDeployments.mockResolvedValue([MAIN])
    m.clientFor.mockReturnValue(client)
    m.hasWallet.mockReturnValue(true)
    m.provider.mockReturnValue(fakeProvider([ALICE]))
    m.wallets.mockReturnValue([])
    m.connect.mockResolvedValue({ account: ALICE })
    await renderPool(root, 'mainnet-1', 7n)
    await flush()
    await openSheet()
    expect(client.readContract.mock.calls.filter((c) => c[0].functionName === 'maxDevBps')).toHaveLength(2)
    expect(tabBody()).toContain('≈ 2.0000 QIE')
  })

  it('shows the contract revert reason, or an RPC sentence, when the quote cannot be read', async () => {
    await open({ account: ALICE })
    const real = client.readContract.getMockImplementation()!
    client.readContract.mockImplementation(async (c: { functionName: string }) => {
      if (c.functionName === 'quoteQIE') throw revert({ errorName: 'OracleStale' })
      return real(c as never)
    })
    await openSheet()
    expect(tabBody()).toContain('The QIE Oracle price is too old')
    sheet().close()
    client.readContract.mockImplementation(async (c: { functionName: string }) => {
      if (c.functionName === 'quoteQIE') throw new BaseError('timeout')
      return real(c as never)
    })
    await openSheet()
    expect(tabBody()).toBe("QIE's RPCs aren't answering right now. Close this and try again in a moment.")
    sheet().close()
    client.getBlock.mockRejectedValueOnce(new Error('down'))
    await openSheet()
    expect(tabBody()).toContain("QIE's RPCs aren't answering")
  })

  it('pays in QIE with the quote shown: expiry = quote block time + 5 min, value = the shown max, then closes', async () => {
    await open({ account: ALICE })
    await openSheet()
    inSheet('[data-pay="qie"]')!.click()
    await flush()
    expect(client.simulateContract.mock.calls[0][0]).toMatchObject({ functionName: 'joinWithQIE', args: [7n, 1, BigInt(TS + 300)], value: 2_020_000_000_000_000_000n })
    expect(sheet().open).toBe(false)
    expect($('.msg')!.textContent).toContain('✓ Seat paid in QIE.')
  })

  it('re-quotes instead of paying when the shown QIE price is more than a minute old', async () => {
    await open({ account: ALICE })
    await openSheet()
    st.ts = TS + 61
    inSheet('[data-pay="qie"]')!.click()
    await flush()
    expect(client.simulateContract).not.toHaveBeenCalled()
    expect(inSheet('.sheetmsg')!.textContent).toContain('That price was more than a minute old')
    expect(inSheet<HTMLButtonElement>('[data-pay="qie"]')!.disabled).toBe(false)
  })

  it('a re-quote that finds the pool closed shows why, not the stale-price notice', async () => {
    await open({ account: ALICE })
    await openSheet()
    client.getBlock.mockImplementationOnce(async () => {
      // the freshness check: meanwhile the last seat was paid and a poll saw it
      st.filled = 5
      poll()
      await flush()
      return { number: st.block, timestamp: BigInt(TS + 61) }
    })
    inSheet('[data-pay="qie"]')!.click()
    await flush(20)
    expect(sheet().textContent).toContain("This pool is closed: it's full, expired or cancelled.")
    expect(sheet().textContent).not.toContain('more than a minute old')
  })

  it('steps seats between 1 and the seats left, and pays for the count shown', async () => {
    await open({ account: ALICE })
    await openSheet()
    expect(inSheet('[data-n="-1"]')!.disabled).toBe(true)
    for (let i = 0; i < 4; i++) {
      inSheet('[data-n="1"]')!.click()
      await flush()
    }
    expect(inSheet('output')!.textContent).toBe('3') // 5 seats, 2 filled
    expect(inSheet('[data-n="1"]')!.disabled).toBe(true)
    inSheet('[data-n="-1"]')!.click()
    await flush()
    expect(inSheet('output')!.textContent).toBe('2')
    expect(inSheet('.stepper .data')!.textContent).toBe('4.00 QUSDC')
    inSheet('[data-pay="qie"]')!.click()
    await flush()
    expect(client.simulateContract.mock.calls[0][0]).toMatchObject({ args: [7n, 2, BigInt(TS + 300)] })
    expect($('.msg')!.textContent).toContain('✓ Seats paid in QIE.')
  })

  it('clamps the seat count when the pool fills up while the sheet is open', async () => {
    await open({ account: ALICE })
    await openSheet()
    inSheet('[data-n="1"]')!.click()
    inSheet('[data-n="1"]')!.click()
    await flush()
    st.filled = 4
    st.members.push({ addr: BOB, seats: 2, owed: 2n * PRICE })
    poll()
    await flush()
    inSheet('[data-tab="qusdc"]')!.click()
    await flush()
    expect(inSheet('output')!.textContent).toBe('1')
  })

  it('opens on Pay with QUSDC when the wallet already holds one seat in QUSDC, approve then pay', async () => {
    await open({ account: ALICE, state: { balance: 5_000_000n } })
    await openSheet()
    expect(inSheet('[data-tab="qusdc"]')!.getAttribute('aria-selected')).toBe('true')
    expect(tabBody()).toContain('This wallet holds 5.00 QUSDC. Two steps: approve, then pay.')
    expect(inSheet('[data-pay="approve"]')!.disabled).toBe(false)
    expect(inSheet('[data-pay="join"]')!.disabled).toBe(true)
    inSheet('[data-pay="approve"]')!.click()
    await flush()
    expect(wallet.writeContract.mock.calls[0][0]).toMatchObject({ address: ADDR.qusdc, functionName: 'approve', args: [MAIN.address, PRICE] })
    st.allowance = PRICE
    await flush()
    // the approval re-rendered the sheet with the fresh allowance read
    sheet().close()
    await openSheet()
    expect(inSheet('[data-pay="approve"]')!.disabled).toBe(true)
    inSheet('[data-pay="join"]')!.click()
    await flush()
    expect(client.simulateContract.mock.calls[0][0]).toMatchObject({ functionName: 'join', args: [7n, 1] })
    expect($('.msg')!.textContent).toContain('✓ Seat paid in QUSDC.')
  })

  it('re-renders after an approval lands so "2 · Pay" turns on', async () => {
    await open({ account: ALICE, state: { balance: 5_000_000n } })
    await openSheet()
    client.waitForTransactionReceipt.mockImplementationOnce(async () => {
      st.allowance = PRICE
      return { status: 'success' }
    })
    inSheet('[data-pay="approve"]')!.click()
    await flush()
    expect(inSheet('[data-pay="join"]')!.disabled).toBe(false)
  })

  it('pays for several seats in QUSDC with the plural label', async () => {
    await open({ account: ALICE, state: { balance: 50_000_000n, allowance: 50_000_000n } })
    await openSheet()
    inSheet('[data-n="1"]')!.click()
    await flush()
    inSheet('[data-pay="join"]')!.click()
    await flush()
    expect($('.msg')!.textContent).toContain('✓ Seats paid in QUSDC.')
  })

  it('asks for a wallet with QUSDC on the QUSDC tab when no account is connected, and a failed balance read defaults to QIE', async () => {
    await open({ account: undefined })
    await openSheet()
    inSheet('[data-tab="qusdc"]')!.click()
    await flush()
    expect(tabBody()).toContain('Connect a wallet that holds QUSDC.')
    sheet().close()
    await open({ account: ALICE, state: { balance: 9_000_000n } })
    const real = client.readContract.getMockImplementation()!
    client.readContract.mockImplementationOnce(async () => Promise.reject(new Error('down'))).mockImplementation(real)
    await openSheet()
    expect(inSheet('[data-tab="qie"]')!.getAttribute('aria-selected')).toBe('true')
  })

  it('says the RPCs are not answering when the QUSDC balance cannot be read', async () => {
    await open({ account: ALICE, state: { balance: 5_000_000n } })
    await openSheet()
    const real = client.readContract.getMockImplementation()!
    client.readContract.mockImplementation(async (c: { functionName: string }) => {
      if (c.functionName === 'allowance') throw new Error('down')
      return real(c as never)
    })
    inSheet('[data-tab="qusdc"]')!.click()
    await flush()
    expect(tabBody()).toBe("QIE's RPCs aren't answering right now. Close this and try again in a moment.")
  })

  it('shows why instead of a Pay button when the pool is full, closed or the escrow is short', async () => {
    await open({ account: ALICE, state: { solvent: false } })
    // Join is hidden on the page; the sheet still guards itself (e.g. reopened from a stale tap)
    st.solvent = true
    poll()
    await flush()
    await openSheet()
    st.solvent = false
    poll()
    await flush()
    inSheet('[data-tab="qusdc"]')!.click()
    await flush()
    expect(sheet().textContent).toContain('New seats are paused')
    sheet().close()
    st.solvent = true
    st.filled = 5
    poll()
    await flush()
    expect($('[data-act="open-sheet"]')).not.toBeNull() // status still Open on chain until the payout tx
    await openSheet()
    expect(sheet().textContent).toContain("This pool is closed: it's full, expired or cancelled.")
  })

  it('shows why, without paying, when the pool closes while the wallet connects', async () => {
    await open({ account: ALICE })
    await openSheet()
    const c = deferred<{ account: Address }>()
    m.connect.mockReturnValueOnce(c.promise)
    inSheet('[data-pay="qie"]')!.click()
    await flush()
    st.filled = 5
    poll()
    await flush()
    c.resolve({ account: ALICE })
    await flush()
    expect(client.simulateContract).not.toHaveBeenCalled()
    expect(sheet().textContent).toContain("This pool is closed: it's full, expired or cancelled.")
  })

  it('shows why, without paying, when fewer seats are left than the sheet showed', async () => {
    await open({ account: ALICE, state: { balance: 9_000_000n, allowance: 9_000_000n } })
    await openSheet()
    inSheet('[data-n="1"]')!.click()
    inSheet('[data-n="1"]')!.click()
    await flush()
    const c = deferred<{ account: Address }>()
    m.connect.mockReturnValueOnce(c.promise)
    inSheet('[data-pay="join"]')!.click()
    await flush()
    st.filled = 4
    st.members.push({ addr: BOB, seats: 2, owed: 2n * PRICE })
    poll()
    await flush()
    c.resolve({ account: ALICE })
    await flush()
    expect(client.simulateContract).not.toHaveBeenCalled()
    expect(inSheet('output')!.textContent).toBe('1')
  })

  it('starts nothing when the sheet is closed while the wallet connects', async () => {
    await open({ account: ALICE, state: { balance: 9_000_000n } })
    await openSheet()
    const c1 = deferred<{ account: Address }>()
    const c2 = deferred<{ account: Address }>()
    m.connect.mockReturnValueOnce(c1.promise).mockReturnValueOnce(c2.promise)
    inSheet('[data-pay="join"]')!.disabled = false
    inSheet('[data-pay="join"]')!.click()
    await flush()
    sheet().close()
    c1.resolve({ account: ALICE })
    await flush()
    await openSheet()
    inSheet('[data-pay="approve"]')!.click()
    await flush()
    sheet().close()
    c2.resolve({ account: ALICE })
    await flush()
    expect(client.simulateContract).not.toHaveBeenCalled()
    expect(wallet.writeContract).not.toHaveBeenCalled()
  })

  it('ignores a second tap while a payment or approval is in flight', async () => {
    await open({ account: ALICE, state: { balance: 9_000_000n } })
    await openSheet()
    const c = deferred<{ account: Address }>()
    m.connect.mockReturnValueOnce(c.promise)
    const approve = inSheet('[data-pay="approve"]')!
    approve.click()
    await flush()
    expect(approve.disabled).toBe(true) // locked
    const join = inSheet('[data-pay="join"]')!
    join.onclick!(new MouseEvent('click') as PointerEvent)
    approve.onclick!(new MouseEvent('click') as PointerEvent)
    await flush()
    expect(m.connect).toHaveBeenCalledTimes(1)
    c.resolve({ account: ALICE })
    await flush()
  })

  it('keeps the sheet open with the reason and unlocks it when a payment or approval fails', async () => {
    await open({ account: ALICE, state: { balance: 9_000_000n } })
    await openSheet()
    wallet.writeContract.mockRejectedValueOnce(rejected())
    inSheet('[data-pay="approve"]')!.click()
    await flush()
    expect(inSheet('.sheetmsg')!.textContent).toBe('You cancelled in the wallet. Nothing was sent.')
    expect(inSheet('[data-pay="approve"]')!.disabled).toBe(false)
    expect(inSheet('[data-pay="join"]')!.disabled).toBe(true) // restored, not blindly enabled
    st.allowance = 9_000_000n
    sheet().close()
    await openSheet()
    client.simulateContract.mockRejectedValueOnce(revert({ errorName: 'TooManySeats' }))
    inSheet('[data-pay="join"]')!.click()
    await flush()
    expect(sheet().open).toBe(true)
    expect(inSheet('.sheetmsg')!.textContent).toBe('There are not that many seats left. Pick fewer seats.')
  })

  it('never writes into a reopened sheet from work started for an earlier one', async () => {
    await open({ account: ALICE, state: { balance: 9_000_000n } })
    await openSheet()
    // approval fails after the sheet was closed
    const w = deferred<Hash>()
    wallet.writeContract.mockReturnValueOnce(w.promise)
    inSheet('[data-pay="approve"]')!.click()
    await flush()
    sheet().close()
    w.reject(rejected())
    await flush()
    // approval lands after the sheet was closed
    await openSheet()
    const w2 = deferred<Hash>()
    wallet.writeContract.mockReturnValueOnce(w2.promise)
    inSheet('[data-pay="approve"]')!.click()
    await flush()
    sheet().close()
    w2.resolve(hash(3))
    await flush()
    // a join that fails after the sheet was closed
    st.allowance = 9_000_000n
    await openSheet()
    const sim = deferred<never>()
    client.simulateContract.mockReturnValueOnce(sim.promise)
    inSheet('[data-pay="join"]')!.click()
    await flush()
    sheet().close()
    sim.reject(revert({ errorName: 'PoolNotOpen' }))
    await flush()
    expect(sheet().open).toBe(false)
    expect($('.msg')!.textContent).toContain("This pool is closed: it's full, expired or cancelled.")
  })

  it('drops a QIE quote, re-quote or join that lands after the sheet was closed', async () => {
    await open({ account: ALICE })
    // closed while the quote block is read
    const b = deferred<{ number: bigint; timestamp: bigint }>()
    client.getBlock.mockReturnValueOnce(b.promise)
    await openSheet()
    sheet().close()
    b.resolve({ number: st.block, timestamp: BigInt(TS) })
    await flush()
    // closed while the quote itself is read
    const real = client.readContract.getMockImplementation()!
    const qd = deferred<[bigint, bigint, bigint]>()
    client.readContract.mockImplementation(async (c: { functionName: string }) => (c.functionName === 'quoteQIE' ? qd.promise : real(c as never)))
    await openSheet()
    sheet().close()
    qd.resolve(st.quote)
    await flush()
    // closed while a failing quote read is pending
    const qf = deferred<never>()
    client.readContract.mockImplementation(async (c: { functionName: string }) => (c.functionName === 'quoteQIE' ? qf.promise : real(c as never)))
    await openSheet()
    sheet().close()
    qf.reject(new Error('late'))
    await flush()
    client.readContract.mockImplementation(real)
    // closed while the freshness check of a re-quote is pending
    await openSheet()
    const fresh = deferred<{ number: bigint; timestamp: bigint }>()
    client.getBlock.mockReturnValueOnce(fresh.promise)
    inSheet('[data-pay="qie"]')!.click()
    await flush()
    sheet().close()
    fresh.resolve({ number: st.block, timestamp: BigInt(TS + 120) })
    await flush()
    // closed while the join is being mined: the page still shows the result
    await openSheet()
    const r = deferred<{ status: string }>()
    client.waitForTransactionReceipt.mockReturnValueOnce(r.promise)
    inSheet('[data-pay="qie"]')!.click()
    await flush()
    sheet().close()
    r.resolve({ status: 'success' })
    await flush()
    expect(sheet().open).toBe(false)
    expect($('.msg')!.textContent).toContain('✓ Seat paid in QIE.')
  })

  it('drops a QUSDC balance read that lands after the sheet was closed', async () => {
    await open({ account: ALICE, state: { balance: 9_000_000n } })
    const real = client.readContract.getMockImplementation()!
    // the F9 default-tab read
    const first = deferred<bigint>()
    client.readContract.mockImplementationOnce(() => first.promise)
    await openSheet()
    sheet().close()
    first.resolve(9_000_000n)
    await flush()
    // the QUSDC tab reads, succeeding and failing late
    for (const settle of ['resolve', 'reject'] as const) {
      const late = deferred<bigint>()
      client.readContract.mockImplementation(async (c: { functionName: string }) => (c.functionName === 'allowance' ? late.promise : real(c as never)))
      await openSheet()
      sheet().close()
      if (settle === 'resolve') late.resolve(0n)
      else late.reject(new Error('late'))
      await flush()
    }
    expect(sheet().open).toBe(false)
  })

  it('a re-quote that lands after the sheet closed and reopened leaves the new sheet alone', async () => {
    await open({ account: ALICE })
    await openSheet()
    st.ts = TS + 61
    const quoteBlock = deferred<{ number: bigint; timestamp: bigint }>()
    client.getBlock
      .mockImplementationOnce(async () => ({ number: st.block, timestamp: BigInt(st.ts) })) // freshness check
      .mockImplementationOnce(() => quoteBlock.promise) // the re-quote render
    inSheet('[data-pay="qie"]')!.click()
    await flush()
    sheet().close()
    quoteBlock.resolve({ number: st.block, timestamp: BigInt(st.ts) })
    await flush()
    expect(sheet().open).toBe(false)
    expect(client.simulateContract).not.toHaveBeenCalled()
  })

  it('a re-quote whose sheet closes during the fresh render shows no stale message', async () => {
    await open({ account: ALICE })
    await openSheet()
    st.ts = TS + 61
    inSheet('[data-pay="qie"]')!.click()
    // close as soon as the requote path starts re-rendering
    const real = client.readContract.getMockImplementation()!
    client.readContract.mockImplementation(async (c: { functionName: string }) => {
      if (c.functionName === 'quoteQIE') sheet().close()
      return real(c as never)
    })
    await flush()
    expect(sheet().open).toBe(false)
  })

  it('reuses an already open sheet when Join is tapped again', async () => {
    await open({ account: ALICE })
    await openSheet()
    const show = vi.spyOn(sheet(), 'showModal')
    $<HTMLButtonElement>('[data-act="open-sheet"]')!.click()
    await flush()
    expect(show).not.toHaveBeenCalled()
    expect(sheet().open).toBe(true)
  })
})
