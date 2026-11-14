/**
 * EIP-1193 wallet (QIE Wallet, MetaMask, any injected provider) on chain 1990.
 * Several wallet extensions fight over window.ethereum (MetaMask usually wins), so wallets are discovered with
 * EIP-6963 and QIE Wallet is preferred when present; a choice the user made is remembered.
 */
import { createWalletClient, custom, numberToHex, type Address, type EIP1193Provider } from 'viem'
import { QIE_RPCS, qieMainnet } from './chain'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string }
export type WalletDetail = { info: WalletInfo; provider: EIP1193Provider }

const found: WalletDetail[] = []
const KEY = 'patungan.wallet'
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e: Event) => {
    const d = (e as CustomEvent<WalletDetail>).detail
    if (d?.info?.uuid && d.provider && !found.some((f) => f.info.uuid === d.info.uuid)) found.push(d)
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/** Pure: the remembered wallet, else QIE Wallet, else the injected default, else the first announced one. */
export function pickProvider(
  list: WalletDetail[],
  saved: string | null,
  fallback: EIP1193Provider | undefined,
): EIP1193Provider | undefined {
  const bySaved = saved ? list.find((d) => d.info.rdns === saved) : undefined
  if (bySaved) return bySaved.provider
  const qie = list.find((d) => /qie/i.test(d.info.name) || /qie/i.test(d.info.rdns))
  if (qie) return qie.provider
  return fallback ?? list[0]?.provider
}

const savedChoice = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Wallet extensions that announced themselves (EIP-6963). */
export const wallets = () => found.slice()

/** Remember the wallet the user picked (by EIP-6963 rdns). */
export function chooseWallet(rdns: string) {
  try {
    localStorage.setItem(KEY, rdns)
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

export const provider = (): EIP1193Provider | undefined =>
  typeof window === 'undefined' ? undefined : pickProvider(found, savedChoice(), window.ethereum)

export const hasWallet = () => !!provider()

/** Ask the wallet for an account and make sure it is on QIE mainnet (adds the chain if the wallet lacks it). */
export async function connect(): Promise<{ account: Address; wallet: ReturnType<typeof walletFor> }> {
  const eth = provider()
  if (!eth) throw new Error('NoWallet')
  const [account] = (await eth.request({ method: 'eth_requestAccounts' })) as Address[]
  const chainHex = numberToHex(qieMainnet.id)
  if ((await eth.request({ method: 'eth_chainId' })) !== chainHex) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] })
    } catch {
      // QIE docs (set-up-a-wallet): network name QIEMainnet, symbol QIEV3
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainHex,
            chainName: qieMainnet.name,
            nativeCurrency: qieMainnet.nativeCurrency,
            rpcUrls: QIE_RPCS,
            blockExplorerUrls: [qieMainnet.blockExplorers.default.url],
          },
        ],
      })
    }
  }
  return { account, wallet: walletFor(account) }
}

export function walletFor(account: Address) {
  return createWalletClient({ account, chain: qieMainnet, transport: custom(provider()!) })
}

/** MetaMask's in-app browser deep link, for members who open the pool inside WhatsApp. */
export const metamaskDeepLink = (url: string) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}`
