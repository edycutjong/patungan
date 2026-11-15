// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deployment } from './chain'
import { flush } from './test/logs'

const m = vi.hoisted(() => ({
  renderPool: vi.fn(),
  renderCreate: vi.fn(),
  renderVerify: vi.fn(),
  loadDeployments: vi.fn(),
  clientFor: vi.fn(),
  client: { getBlockNumber: vi.fn(), readContract: vi.fn() },
}))
vi.mock('./pool', () => ({ renderPool: m.renderPool }))
vi.mock('./create', () => ({ renderCreate: m.renderCreate }))
vi.mock('./verify', () => ({ renderVerify: m.renderVerify }))
vi.mock('./chain', async (orig) => ({ ...(await orig<typeof import('./chain')>()), loadDeployments: m.loadDeployments, clientFor: m.clientFor, client: m.client }))

const MAIN: Deployment = { id: 'mainnet-1', label: 'QIE mainnet', address: '0x2f4646D52a5393E239f5b880411dC2CA2D945F31', deployBlock: 1, chainId: 1990 }
const FORK: Deployment = { ...MAIN, id: 'fork', label: 'Fork', rpc: 'http://127.0.0.1:8545' }

async function open(path: string) {
  history.replaceState({}, '', path)
  document.body.innerHTML = '<main id="app"></main>'
  vi.resetModules()
  await import('./main')
  await flush()
  return document.querySelector<HTMLElement>('#app')!
}

/** A pool tuple as getPool returns it: [pool, title, payeeName, memberCount, refundedCount, refundable]. */
const pool = (o: { status?: number; seats?: number; filled?: number; deadline?: number; title?: string; members?: bigint; refunded?: bigint }) => [
  { organizer: MAIN.address, payee: MAIN.address, price: 2_000_000n, deadline: o.deadline ?? 2_000_000_000, seats: o.seats ?? 5, filled: o.filled ?? 0, status: o.status ?? 0, held: 0n },
  o.title ?? '',
  '',
  o.members ?? 0n,
  o.refunded ?? 0n,
  false,
]

function poolsClient(next: bigint, byId: (id: bigint) => unknown[], ts = 1_800_000_000n) {
  return {
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: bigint[] }) => (functionName === 'nextId' ? next : byId(args![0]))),
    getBlock: vi.fn(async () => ({ timestamp: ts })),
  }
}

beforeEach(() => {
  for (const f of [m.renderPool, m.renderCreate, m.renderVerify, m.loadDeployments, m.clientFor, m.client.getBlockNumber, m.client.readContract]) f.mockReset()
  m.loadDeployments.mockResolvedValue([])
  m.client.getBlockNumber.mockResolvedValue(11_900_000n)
  m.client.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === 'latestRoundData' ? [1n, 1_234_000_000n, 0n, 1_799_996_400n, 1n] : [1_705_000_000_000_000_000n, 250_000n],
  )
})

describe('routing on location.pathname', () => {
  it('opens the pool page for /p/<deployment>/<id>', async () => {
    const app = await open('/p/mainnet-1/7/')
    expect(m.renderPool).toHaveBeenCalledWith(app, 'mainnet-1', 7n)
    expect(m.renderCreate).not.toHaveBeenCalled()
  })
  it('opens the create form for /new, with or without a trailing slash', async () => {
    await open('/new/')
    expect(m.renderCreate).toHaveBeenCalledTimes(1)
  })
  it('opens the verify page for /verify', async () => {
    await open('/verify')
    expect(m.renderVerify).toHaveBeenCalledTimes(1)
  })
  it('falls back to the pools home for any other path', async () => {
    const app = await open('/pools')
    expect(app.querySelector('h1')!.textContent).toBe('Patungan')
    expect(m.renderPool).not.toHaveBeenCalled()
  })
})

describe('pools home', () => {
  it('shows live QIE mainnet reads: block, Oracle price with its age, and the QIEDEX quote for one seat', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const app = await open('/pools')
    const status = app.querySelector('#status')!.textContent!
    expect(status).toContain('QIE mainnet block11900000')
    expect(status).toContain('12.34 USDT, updated 1 h ago')
    expect(status).toContain('QIE for a 0.25 QUSDC seat (QIEDEX quote)1.705')
    vi.restoreAllMocks()
  })

  it('says the chain is not answering when a live read fails', async () => {
    m.client.getBlockNumber.mockRejectedValue(new Error('all five RPCs timed out'))
    const app = await open('/pools')
    expect(app.querySelector('#status')!.textContent).toBe('QIE mainnetnot answering (all five RPCs timed out)')
  })

  it('says there are no pools yet when no deployment is known', async () => {
    const app = await open('/pools')
    expect(app.querySelector('#pools')!.textContent).toBe('No pools yet. The mainnet contract is not deployed yet.')
  })

  it('lists pools newest first with their stamp, and a fork that is not answering', async () => {
    m.loadDeployments.mockResolvedValue([MAIN, FORK])
    const kinds: Record<string, unknown[]> = {
      '3': pool({ status: 1, seats: 2, filled: 2, title: 'Futsal <Thursday>', members: 2n }),
      '2': pool({ deadline: 1_000, filled: 1, members: 1n }),
      '1': pool({}),
    }
    m.clientFor.mockImplementation((d: Deployment) => {
      if (d.rpc) return { readContract: vi.fn().mockRejectedValue(new Error('down')), getBlock: vi.fn() }
      return poolsClient(3n, (id) => kinds[String(id)])
    })
    const app = await open('/pools')
    const items = [...app.querySelectorAll('#pools li')]
    expect(items.map((li) => li.querySelector('.mini')?.textContent)).toEqual(['PAID IN FULL', 'CLOSED · refunds available', 'OPEN', undefined])
    expect(items[0].querySelector('b')!.textContent).toBe('Futsal Thursday') // markup characters stripped
    expect(items[0].querySelector('a')!.getAttribute('href')).toBe('/p/mainnet-1/3')
    expect(items[1].querySelector('b')!.textContent).toBe('Pool #2')
    expect(items[2].textContent).toContain('0/5 · 2.00 QUSDC')
    expect(items[2].textContent).toContain('QIE mainnet')
    expect(items[3].textContent).toBe('Fork: not answering. Nothing was sent and no money moved: this page only reads the chain. Retry')
    expect(items[3].querySelector('button[data-act="retry"]')).not.toBeNull()
  })

  it('Retry re-runs every read on the page and lists the pools once QIE answers', async () => {
    m.loadDeployments.mockResolvedValue([MAIN])
    m.clientFor.mockReturnValue({ readContract: vi.fn().mockRejectedValue(new Error('500')), getBlock: vi.fn().mockRejectedValue(new Error('500')) })
    const app = await open('/pools')
    expect(app.querySelector('#pools')!.textContent).toContain('QIE mainnet: not answering. Nothing was sent')
    m.clientFor.mockReturnValue(poolsClient(1n, () => pool({ title: 'Futsal' })))
    app.querySelector<HTMLButtonElement>('[data-act="retry"]')!.click()
    await flush()
    expect(app.querySelector('#pools b')!.textContent).toBe('Futsal')
    expect(app.querySelector('#pools [data-act="retry"]')).toBeNull()
    expect(app.querySelectorAll('#status dt')).toHaveLength(3) // one set of live rows, from the new render only
  })

  it('says QIE is not answering after a few seconds while the pool reads hang, and drops the hung run after a Retry', async () => {
    const realTimeout = globalThis.setTimeout
    const slow: (() => void)[] = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 4_000) {
        slow.push(fn)
        return 0
      }
      return realTimeout(fn, ms)
    }) as never)
    let land!: (deps: Deployment[]) => void
    m.loadDeployments.mockReturnValueOnce(new Promise((r) => (land = r)))
    let block!: (n: bigint) => void
    m.client.getBlockNumber.mockReturnValueOnce(new Promise<bigint>((r) => (block = r)))
    const app = await open('/pools')
    expect(app.querySelector('#pools')!.textContent).toBe('Reading…')
    slow[0]()
    expect(app.querySelector('#pools')!.textContent).toContain('QIE mainnet: not answering. Nothing was sent')
    m.loadDeployments.mockResolvedValue([])
    app.querySelector<HTMLButtonElement>('[data-act="retry"]')!.click()
    await flush()
    expect(app.querySelector('#pools')!.textContent).toBe('No pools yet. The mainnet contract is not deployed yet.')
    const status = app.querySelector('#status')!.textContent
    // the first render's hung reads land now: they write nothing, and its late timer paints no notice
    land([MAIN])
    block(1n)
    await flush()
    slow[0]()
    expect(app.querySelector('#pools')!.textContent).toBe('No pools yet. The mainnet contract is not deployed yet.')
    expect(app.querySelector('#status')!.textContent).toBe(status)
    vi.restoreAllMocks()
  })

  it('shows at most the ten newest pools per deployment and labels a local fork', async () => {
    m.loadDeployments.mockResolvedValue([FORK])
    m.clientFor.mockReturnValue(poolsClient(12n, () => pool({ status: 2 })))
    const app = await open('/pools')
    const items = [...app.querySelectorAll('#pools li')]
    expect(items).toHaveLength(10)
    expect(items[0].querySelector('a')!.getAttribute('href')).toBe('/p/fork/12')
    expect(items[9].querySelector('a')!.getAttribute('href')).toBe('/p/fork/3')
    expect(items[0].querySelector('.mini')!.textContent).toBe('CANCELLED')
    expect(items[0].textContent).toContain('local fork')
  })
})
