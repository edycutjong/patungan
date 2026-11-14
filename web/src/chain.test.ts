import { afterEach, describe, expect, it, vi } from 'vitest'

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('deployment manifest', () => {
  it('dev server merges deployments.json with the local anvil manifest', async () => {
    const f = vi.fn(async (url: string) =>
      url === '/deployments.json' ? okJson({ deployments: [{ id: 'mainnet-1' }] }) : okJson({ deployments: [{ id: 'local' }] }),
    )
    vi.stubGlobal('fetch', f)
    const { loadDeployments } = await import('./chain')
    expect((await loadDeployments()).map((d) => d.id)).toEqual(['mainnet-1', 'local'])
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('is fetched once per page load (the promise is cached)', async () => {
    const f = vi.fn(async () => okJson({ deployments: [] }))
    vi.stubGlobal('fetch', f)
    const { loadDeployments } = await import('./chain')
    await loadDeployments()
    await loadDeployments()
    expect(f).toHaveBeenCalledTimes(2) // two files, one load
  })

  it('treats a missing file, a manifest without deployments, and a network error as no deployments', async () => {
    const f = vi.fn(async (url: string) => {
      if (url === '/deployments.json') return { ok: false, json: async () => ({}) } as Response
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', f)
    const { loadDeployments } = await import('./chain')
    expect(await loadDeployments()).toEqual([])

    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => okJson({})))
    const again = await import('./chain')
    expect(await again.loadDeployments()).toEqual([])
  })

  it('production build reads only the mainnet manifest', async () => {
    vi.stubEnv('DEV', false)
    const f = vi.fn(async () => okJson({ deployments: [{ id: 'mainnet-1' }] }))
    vi.stubGlobal('fetch', f)
    const { loadDeployments } = await import('./chain')
    expect(await loadDeployments()).toHaveLength(1)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledWith('/deployments.json')
  })
})

describe('clients and explorer links', () => {
  const dep = { id: 'm', label: 'QIE mainnet', address: '0x2f4646D52a5393E239f5b880411dC2CA2D945F31', deployBlock: 1, chainId: 1990 } as const

  it('mainnet deployments share the 5-RPC failover client and get explorer links', async () => {
    const { client, clientFor, hasExplorer, explorerTx, explorerAddress, QIE_RPCS, qieMainnet } = await import('./chain')
    expect(clientFor(dep)).toBe(client)
    expect(hasExplorer(dep)).toBe(true)
    expect(QIE_RPCS).toHaveLength(5)
    expect(qieMainnet.id).toBe(1990)
    expect(explorerTx('0xabc')).toBe('https://mainnet.qie.digital/tx/0xabc')
    expect(explorerAddress('0xdef')).toBe('https://mainnet.qie.digital/address/0xdef')
  })

  it('a local fork gets its own client, reused per RPC URL, and no explorer links', async () => {
    const { client, clientFor, hasExplorer } = await import('./chain')
    const fork = { ...dep, rpc: 'http://127.0.0.1:8545' }
    const c = clientFor(fork)
    expect(c).not.toBe(client)
    expect(clientFor({ ...fork })).toBe(c)
    expect(hasExplorer(fork)).toBe(false)
  })
})
