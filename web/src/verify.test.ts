// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deployment } from './chain'
import { addr, encodeLog, hash } from './test/logs'

const chain = vi.hoisted(() => ({ loadDeployments: vi.fn(), clientFor: vi.fn() }))
vi.mock('./chain', async (orig) => ({ ...(await orig<typeof import('./chain')>()), ...chain }))

import { ADDR } from './chain'
import { fetchVerified, renderVerify } from './verify'

const MAIN: Deployment = { id: 'mainnet-1', label: 'QIE mainnet', address: '0x2f4646D52a5393E239f5b880411dC2CA2D945F31', deployBlock: 100_000, chainId: 1990 }
const FORK: Deployment = { ...MAIN, id: 'fork', label: 'anvil <fork>', rpc: 'http://127.0.0.1:8545' }

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

const created = (id: bigint, payeeName: string, block: bigint) =>
  encodeLog(MAIN.address, 'PoolCreated', { id, organizer: addr(1), payee: addr(2), payeeName, price: 2_000_000n, seats: 5, deadline: 2_000_000_000, title: 't' }, hash(Number(id)), block)
const joined = (n: number, qie: boolean, block: bigint) =>
  encodeLog(MAIN.address, 'Joined', { id: 1n, member: addr(3), n, amount: 2_000_000n * BigInt(n), paidWithQIE: qie, qieSpent: 0n, oraclePrice: 0n }, hash(100 + n), block)

/** A Blockscout /logs item for a log. */
const item = (l: ReturnType<typeof encodeLog>) => ({ topics: [...l.topics, null], data: l.data, transaction_hash: l.transactionHash, block_number: Number(l.blockNumber) })

function fakeClient(o: { reads?: Partial<Record<string, unknown>>; failReads?: boolean; head?: bigint; logs?: (from: bigint, to: bigint) => unknown[]; failHead?: boolean } = {}) {
  const reads: Record<string, unknown> = { isSolvent: true, totalHeld: 4_000_000n, nextId: 3n, maxDevBps: 1500n, qusdc: ADDR.qusdc, router: ADDR.router, zone: ADDR.zone, oracle: ADDR.oracle, ...o.reads }
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (o.failReads) throw new Error('rpc down')
      return reads[functionName]
    }),
    getBlockNumber: vi.fn(async () => {
      if (o.failHead) throw new Error('rpc down')
      return o.head ?? 200_000n
    }),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => o.logs?.(fromBlock, toBlock) ?? []),
  }
}

let root: HTMLElement
beforeEach(() => {
  root = document.createElement('main')
  document.body.replaceChildren(root)
  chain.loadDeployments.mockReset()
  chain.clientFor.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('fetchVerified (Blockscout API v2)', () => {
  it('reads the verified flag, name, compiler and date', async () => {
    const f = vi.fn(async () => json(200, { is_verified: true, is_partially_verified: false, name: 'Patungan', compiler_version: 'v0.8.30', verified_at: '2026-11-13T00:00:00Z' }))
    expect(await fetchVerified('0xabc', f as never)).toEqual({ isVerified: true, partial: false, name: 'Patungan', compiler: 'v0.8.30', at: '2026-11-13T00:00:00Z' })
    expect(f).toHaveBeenCalledWith('https://mainnet.qie.digital/api/v2/smart-contracts/0xabc')
  })
  it('reports an unverified contract when the explorer answers 404', async () => {
    expect(await fetchVerified('0xabc', (async () => json(404, {})) as never)).toEqual({ isVerified: false })
  })
  it('reports "could not check" when the explorer errors or is unreachable', async () => {
    expect(await fetchVerified('0xabc', (async () => json(502, {})) as never)).toEqual({ isVerified: undefined })
    expect(await fetchVerified('0xabc', (async () => Promise.reject(new Error('offline'))) as never)).toEqual({ isVerified: undefined })
  })
  it('treats missing flags in the record as not verified', async () => {
    expect(await fetchVerified('0xabc', (async () => json(200, {})) as never)).toMatchObject({ isVerified: false, partial: false })
  })
})

describe('verify page', () => {
  it('says the deployment list could not load when the manifest read fails', async () => {
    chain.loadDeployments.mockRejectedValue(new Error('boom'))
    await renderVerify(root)
    expect(root.querySelector('#vbody')!.textContent).toContain('Could not load the deployment list')
  })

  it('shows the four live QIE components when no contract is deployed yet', async () => {
    chain.loadDeployments.mockResolvedValue([])
    await renderVerify(root)
    expect(root.textContent).toContain('not deployed on QIE mainnet yet')
    expect(root.querySelectorAll('#vbody dt')).toHaveLength(4)
    expect(root.querySelector('.lede')!.textContent).toContain('QIE mainnet and its explorer')
  })

  it('shows the verified badge, solvency, matching immutables and Blockscout events for a mainnet deployment', async () => {
    chain.loadDeployments.mockResolvedValue([MAIN])
    chain.clientFor.mockReturnValue(fakeClient())
    const unwatched = encodeLog(MAIN.address, 'PoolCancelled', { id: 9n }, hash(9), 5n)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/logs')
          ? json(200, { items: [item(created(1n, 'lapangan', 10n)), item(created(2n, '', 12n)), item(joined(1, true, 11n)), item(joined(2, false, 13n)), item(unwatched)] })
          : json(200, { is_verified: true, is_partially_verified: false, name: 'Patungan', compiler_version: 'v0.8.30', verified_at: '2026-11-13T09:00:00Z' }),
      ),
    )
    await renderVerify(root)
    const body = root.querySelector('#vbody')!
    expect(body.querySelector('.vbadge.ok')!.textContent).toBe('✓ Source verified on Blockscout')
    expect(body.textContent).toContain('Patungan · v0.8.30 · 2026-11-13')
    expect(body.textContent).toContain('Solvent (QUSDC balance ≥ held)yes')
    expect(body.textContent).toContain('1500 (15%)')
    expect(body.textContent).toContain('These match the addresses linked below.')
    expect(body.textContent).toContain('via Blockscout API v2')
    const events = [...body.querySelectorAll('.events li')].map((li) => li.textContent!.replace(/\s+/g, ' '))
    // newest block first; the cancelled event is not one of the watched four
    expect(events).toHaveLength(4)
    expect(events[0]).toContain('Joined #1')
    expect(events[0]).toContain('2 seats · 4.00 QUSDC')
    expect(events[0]).not.toContain('paid in QIE')
    expect(events[1]).toContain('PoolCreated #2')
    expect(events[1]).toContain('5 seats × 2.00 QUSDC')
    expect(events[1]).not.toContain('.qie')
    expect(events[2]).toContain('1 seat · 2.00 QUSDC · paid in QIE')
    expect(events[3]).toContain('→ lapangan.qie')
    expect(body.querySelector('.events a.data')!.getAttribute('href')).toBe(`https://mainnet.qie.digital/tx/${hash(102)}`)
  })

  it('describes payouts and refunds in the event list', async () => {
    chain.loadDeployments.mockResolvedValue([MAIN])
    chain.clientFor.mockReturnValue(fakeClient())
    const paid = encodeLog(MAIN.address, 'PoolPaid', { id: 1n, payee: addr(2), total: 10_000_000n }, hash(201), 21n)
    const refund = encodeLog(MAIN.address, 'Refunded', { id: 2n, member: addr(3), amount: 2_000_000n }, hash(202), 20n)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/logs') ? json(200, { items: [item(refund), item(paid)] }) : json(404, {}))))
    await renderVerify(root)
    const events = [...root.querySelectorAll('.events li')].map((li) => li.textContent!.replace(/\s+/g, ' '))
    expect(events[0]).toContain('PoolPaid #1 0x0000…0002 10.00 QUSDC to the payee')
    expect(events[1]).toContain('Refunded #2 0x0000…0003 2.00 QUSDC refunded')
  })

  it('marks a partially verified contract and one without name, compiler or date', async () => {
    chain.loadDeployments.mockResolvedValue([MAIN])
    chain.clientFor.mockReturnValue(fakeClient({ reads: { isSolvent: false, router: addr(7) } }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/logs') ? json(200, { items: [] }) : json(200, { is_verified: true, is_partially_verified: true }))))
    await renderVerify(root)
    const body = root.querySelector('#vbody')!
    expect(body.querySelector('.vbadge.no')!.textContent).toContain('Partially verified on Blockscout')
    expect(body.textContent).toContain(' · ')
    expect(body.textContent).not.toContain('2026')
    expect(body.textContent).toContain('Solvent (QUSDC balance ≥ held)NO')
    expect(body.textContent).toContain('These do NOT all match the addresses linked below.')
    expect(body.textContent).toContain('No events yet.')
  })

  it('says NOT verified, and falls back to RPC log chunks when the explorer log API fails', async () => {
    chain.loadDeployments.mockResolvedValue([MAIN])
    const client = fakeClient({ head: 200_000n, logs: (from) => (from === 190_001n ? [created(4n, '', 195_000n)] : []) })
    chain.clientFor.mockReturnValue(client)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/logs') ? json(500, {}) : json(404, {}))))
    await renderVerify(root)
    const body = root.querySelector('#vbody')!
    expect(body.querySelector('.vbadge')!.textContent).toBe('✗ Source NOT verified')
    expect(body.textContent).toContain('via QIE RPC (newest 60000 blocks)')
    expect(body.textContent).toContain('PoolCreated #4')
    // six 10,000-block chunks from the head, never below the deploy block (100,000)
    expect(client.getLogs).toHaveBeenCalledTimes(6)
    expect(client.getLogs.mock.calls.at(-1)![0]).toMatchObject({ fromBlock: 140_001n, toBlock: 150_000n })
  })

  it('stops the RPC scan at the deploy block and clamps the oldest chunk to it', async () => {
    chain.loadDeployments.mockResolvedValue([MAIN])
    const client = fakeClient({ head: 115_000n })
    chain.clientFor.mockReturnValue(client)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/logs') ? Promise.reject(new Error('offline')) : json(502, {}))))
    await renderVerify(root)
    expect(root.querySelector('.vbadge')!.textContent).toBe('Explorer not reachable: could not check verification')
    expect(client.getLogs.mock.calls.map((c) => [c[0].fromBlock, c[0].toBlock])).toEqual([
      [105_001n, 115_000n],
      [100_000n, 105_000n],
    ])
  })

  it('stops scanning once 20 events are found, and keeps the newest 20', async () => {
    chain.loadDeployments.mockResolvedValue([FORK])
    const many = Array.from({ length: 25 }, (_, i) => created(BigInt(i + 1), '', 190_000n + BigInt(i)))
    const client = fakeClient({ logs: () => many })
    chain.clientFor.mockReturnValue(client)
    await renderVerify(root)
    expect(client.getLogs).toHaveBeenCalledTimes(1)
    expect(root.querySelectorAll('.events li')).toHaveLength(20)
  })

  it('labels a local fork: no explorer badge, no links, fork RPC as the event source', async () => {
    chain.loadDeployments.mockResolvedValue([FORK])
    chain.clientFor.mockReturnValue(fakeClient({ logs: (from) => (from === 190_001n ? [joined(1, false, 195_000n)] : []) }))
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await renderVerify(root)
    expect(f).not.toHaveBeenCalled()
    expect(root.querySelector('.lede')!.textContent).toContain('this local fork of QIE mainnet')
    expect(root.querySelector('.vbadge')!.textContent).toBe('local test chain · no explorer')
    expect(root.querySelector('.vaddr a')).toBeNull()
    expect(root.querySelector('.events a.data')).toBeNull()
    expect(root.querySelector('.events span.data:last-child')!.textContent).toMatch(/^0x0{8}…$/)
    expect(root.textContent).toContain('via local fork RPC')
    expect(root.querySelector('h2.label')!.textContent).toBe('anvil <fork>')
  })

  it('says reads and events are unavailable when the RPC is down', async () => {
    chain.loadDeployments.mockResolvedValue([FORK])
    chain.clientFor.mockReturnValue(fakeClient({ failReads: true, failHead: true }))
    await renderVerify(root)
    expect(root.textContent).toContain('Contract reads unavailable right now.')
    expect(root.textContent).toContain('Events unavailable right now.')
    expect(root.textContent).not.toContain('Wired at deploy')
  })

  it('keeps the page up when one deployment cannot be read at all', async () => {
    chain.loadDeployments.mockResolvedValue([FORK, MAIN])
    chain.clientFor.mockImplementation((d: Deployment) => {
      if (d.rpc) throw new Error('bad rpc url')
      return fakeClient()
    })
    vi.stubGlobal('fetch', vi.fn(async () => json(404, {})))
    await renderVerify(root)
    expect(root.textContent).toContain('anvil <fork>Could not read this deployment right now.')
    expect(root.querySelector('.lede')!.textContent).toContain('QIE mainnet and its explorer')
    expect(root.querySelector('.vbadge')!.textContent).toBe('✗ Source NOT verified')
  })
})
