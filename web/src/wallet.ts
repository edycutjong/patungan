/** EIP-1193 wallet (QIE Wallet, MetaMask, any injected provider) on chain 1990. */
import { createWalletClient, custom, numberToHex, type Address, type EIP1193Provider } from 'viem'
import { QIE_RPCS, qieMainnet } from './chain'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export const hasWallet = () => typeof window !== 'undefined' && !!window.ethereum

/** Ask the wallet for an account and make sure it is on QIE mainnet (adds the chain if the wallet lacks it). */
export async function connect(): Promise<{ account: Address; wallet: ReturnType<typeof walletFor> }> {
  const eth = window.ethereum
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
  return createWalletClient({ account, chain: qieMainnet, transport: custom(window.ethereum!) })
}

/** MetaMask's in-app browser deep link, for members who open the pool inside WhatsApp. */
export const metamaskDeepLink = (url: string) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}`
