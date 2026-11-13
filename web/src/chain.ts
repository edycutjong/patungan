import { createPublicClient, defineChain, fallback, http, type Address } from 'viem'

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

export const client = createPublicClient({
  chain: qieMainnet,
  transport: fallback(QIE_RPCS.map((url) => http(url, { timeout: 8_000, retryCount: 1 }))),
})

export const explorerTx = (hash: string) => `${qieMainnet.blockExplorers.default.url}/tx/${hash}`
export const explorerAddress = (addr: string) => `${qieMainnet.blockExplorers.default.url}/address/${addr}`
