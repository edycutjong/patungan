import { createClient, defineChain, fallback, http, type Address, type Client, type PublicClient, type Transport } from 'viem'
import { getBlock, getBlockNumber, getContractEvents, getLogs, readContract } from 'viem/actions'

/** The five public QIE mainnet RPCs; the client fails over across them in order. */
export const QIE_RPCS = [1, 2, 3, 4, 5].map((n) => `https://rpc${n}mainnet.qie.digital/`)

/** QIE mainnet, chain 1990. Name and symbol follow the QIE docs' wallet setup page. */
export const qieMainnet = defineChain({
  id: 1990,
  name: 'QIEMainnet',
  nativeCurrency: { name: 'QIE', symbol: 'QIEV3', decimals: 18 },
  rpcUrls: { default: { http: QIE_RPCS } },
  blockExplorers: { default: { name: 'QIE Explorer', url: 'https://mainnet.qie.digital' } },
})

export const ADDR = {
  qusdc: '0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5',
  router: '0x08cd2e72e156D8563B4351eb4065C262A9f553Ef',
  wqie: '0x0087904D95BEe9E5F24dc8852804b547981A9139',
  zone: '0x9aab56e7727af53A3131985BFB16d845319b7bdc',
  oracle: '0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17',
} as const satisfies Record<string, Address>

// viem's fallback runs each endpoint with retryCount 0 (a per-http retryCount is ignored) and retries the whole
// walk instead: by default 3 more walks, 20 requests and ~1 s of backoff per failed call. One more walk is still
// 10 attempts across 5 endpoints. With every RPC answering 500 the pool page now says so in ~0.6 s; before, the
// walk was still running when the 4 s notice fired.
export const client = qieClient(
  fallback(
    QIE_RPCS.map((url) => http(url, { timeout: 8_000 })),
    { retryCount: 1 },
  ),
)

export const explorerTx = (hash: string) => `${qieMainnet.blockExplorers.default.url}/tx/${hash}`
export const explorerAddress = (addr: string) => `${qieMainnet.blockExplorers.default.url}/address/${addr}`

/** One Patungan deployment. `/p/<id>/<pool>` keeps reading the contract it was created on after any redeploy. */
export interface Deployment {
  id: string
  label: string
  address: Address
  deployBlock: number
  chainId: number
  /** Only for local anvil forks; mainnet deployments use the 5-RPC fallback. */
  rpc?: string
  /** Addresses the builder controls: labelled "builder wallet" on every roster, never counted as users. */
  builderWallets?: Address[]
}

let manifest: Promise<Deployment[]> | undefined

/** Reads public/deployments.json (mainnet); the dev server also reads deployments.local.json (anvil fork). */
export function loadDeployments(): Promise<Deployment[]> {
  manifest ??= (async () => {
    const files = import.meta.env.DEV ? ['/deployments.json', '/deployments.local.json'] : ['/deployments.json']
    const lists = await Promise.all(
      files.map((f) =>
        fetch(f)
          .then((r) => (r.ok ? r.json() : { deployments: [] }))
          .then((j: { deployments?: Deployment[] }) => j.deployments ?? [])
          .catch(() => [] as Deployment[]),
      ),
    )
    return lists.flat()
  })()
  return manifest
}

/**
 * The public-client calls the app makes. A full createPublicClient carries every public action (and the signature
 * maths behind verifyMessage), which the first paint of a page never uses. The reads are bundled with the page; the
 * three calls a write needs (simulate, estimate, wait for the receipt) load with their first use.
 */
export type QieClient = Pick<
  PublicClient<Transport, typeof qieMainnet>,
  'readContract' | 'getBlock' | 'getBlockNumber' | 'getContractEvents' | 'getLogs' | 'simulateContract' | 'estimateContractGas' | 'waitForTransactionReceipt'
>

/** A lazily loaded part of the app failed to download (offline, or a deploy replaced the files): nothing was sent. */
export const NOT_LOADED = 'AppNotLoaded'

/** The write-only calls, fetched on first use; a failed download becomes NOT_LOADED for the pages to explain. */
export const writeActions = () =>
  import('./chain-write').catch(() => {
    throw new Error(NOT_LOADED)
  })

function qieClient(transport: Transport): QieClient {
  const c: Client = createClient({ chain: qieMainnet, transport })
  return {
    readContract: (a: never) => readContract(c, a),
    getBlock: (a?: never) => getBlock(c, a),
    getBlockNumber: (a?: never) => getBlockNumber(c, a),
    getContractEvents: (a: never) => getContractEvents(c, a),
    getLogs: (a?: never) => getLogs(c, a),
    simulateContract: async (a: never) => (await writeActions()).simulateContract(c, a),
    estimateContractGas: async (a: never) => (await writeActions()).estimateContractGas(c, a),
    waitForTransactionReceipt: async (a: never) => (await writeActions()).waitForTransactionReceipt(c, a),
  } as unknown as QieClient // each call keeps viem's own generic signature, from PublicClient
}

const clients = new Map<string, QieClient>()

/** A public client for a deployment: its own RPC for a local fork, else the mainnet failover client. */
export function clientFor(dep: Deployment) {
  if (!dep.rpc) return client
  let c = clients.get(dep.rpc)
  if (!c) {
    c = qieClient(http(dep.rpc))
    clients.set(dep.rpc, c)
  }
  return c
}

/** A local fork has no public explorer; links are only rendered for mainnet deployments. */
export const hasExplorer = (dep: Deployment) => !dep.rpc
