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
    /** QIE Wallet's own global (QIE Wallet integration guide, Step 1): always set, QIE Wallet only. */
    qie?: EIP1193Provider
  }
}

export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string }
export type WalletDetail = { info: WalletInfo; provider: EIP1193Provider }

export const QIE_RDNS = 'me.qiewallet'
const found: WalletDetail[] = []
const KEY = 'patungan.wallet'
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e: Event) => {
    const d = (e as CustomEvent<WalletDetail>).detail
    if (d?.info?.uuid && d.provider && !found.some((f) => f.info.uuid === d.info.uuid)) found.push(d)
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/**
 * Pure: the remembered wallet, else QIE Wallet (EIP-6963 rdns me.qiewallet, the guide's primary method), else the
 * injected default, else the first announced one. Never branch on isMetaMask: QIE Wallet also reports it.
 */
export function pickProvider(
  list: WalletDetail[],
  saved: string | null,
  fallback: EIP1193Provider | undefined,
): EIP1193Provider | undefined {
  const bySaved = saved ? list.find((d) => d.info.rdns === saved) : undefined
  if (bySaved) return bySaved.provider
  const qie = list.find((d) => d.info.rdns === QIE_RDNS) ?? list.find((d) => /qie/i.test(d.info.name) || /qie/i.test(d.info.rdns))
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

/** Pure: QIE Wallet first (the chain's own wallet), then the rest in the order they announced. */
export function orderWallets(list: WalletDetail[]): WalletDetail[] {
  const isQie = (d: WalletDetail) => /qie/i.test(d.info.name) || /qie/i.test(d.info.rdns)
  return [...list.filter(isQie), ...list.filter((d) => !isQie(d))]
}

/** Wallet extensions that announced themselves (EIP-6963), QIE Wallet first. */
export const wallets = () => orderWallets(found)

/** Forget the remembered wallet so the next connect shows the picker again. */
export function forgetWallet() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing stored */
  }
}

const safeIcon = (icon: string) => (/^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/i.test(icon) ? icon : '')

/** Show the picker when 2+ wallets are installed and none is remembered (or the remembered one is gone). */
async function ensureChosen(): Promise<void> {
  const list = wallets()
  if (list.length < 2) return
  const saved = savedChoice()
  if (saved && list.some((d) => d.info.rdns === saved)) return
  await new Promise<void>((resolve, reject) => {
    const dlg = document.createElement('dialog')
    dlg.className = 'joinsheet walletsheet'
    dlg.setAttribute('aria-labelledby', 'walletsheet-h')
    dlg.innerHTML = `<h2 id="walletsheet-h">Choose a wallet</h2><ul class="walletlist"></ul><button type="button" class="link" data-cancel>Cancel</button>`
    const ul = dlg.querySelector('ul')!
    list.forEach((d, i) => {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'walletbtn'
      const icon = safeIcon(d.info.icon)
      if (icon) {
        const img = document.createElement('img')
        img.src = icon
        img.alt = ''
        img.width = 32
        img.height = 32
        b.append(img)
      }
      const name = document.createElement('span')
      name.className = 'walletname'
      name.textContent = d.info.name
      b.append(name)
      if (i === 0 && /qie/i.test(d.info.name + d.info.rdns)) {
        const tag = document.createElement('span')
        tag.className = 'mini recommended'
        tag.textContent = 'Recommended'
        b.append(tag)
      }
      b.addEventListener('click', () => {
        chooseWallet(d.info.rdns)
        settled = true
        dlg.close()
        resolve()
      })
      li.append(b)
      ul.append(li)
    })
    let settled = false
    dlg.querySelector('[data-cancel]')!.addEventListener('click', () => dlg.close())
    dlg.addEventListener('close', () => {
      dlg.remove()
      if (!settled) reject(new Error('WalletPickCancelled'))
    })
    document.body.append(dlg)
    dlg.showModal()
    ul.querySelector<HTMLButtonElement>('button')?.focus()
  })
}

/** Remember the wallet the user picked (by EIP-6963 rdns). */
export function chooseWallet(rdns: string) {
  try {
    localStorage.setItem(KEY, rdns)
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

export const provider = (): EIP1193Provider | undefined =>
  typeof window === 'undefined' ? undefined : pickProvider(found, savedChoice(), window.qie ?? window.ethereum)

export const hasWallet = () => !!provider()

/** Ask the wallet for an account and make sure it is on QIE mainnet (adds the chain if the wallet lacks it). */
export async function connect(): Promise<{ account: Address; wallet: ReturnType<typeof walletFor> }> {
  if (!provider()) throw new Error('NoWallet')
  await ensureChosen()
  const eth = provider()
  if (!eth) throw new Error('NoWallet')
  const [account] = (await eth.request({ method: 'eth_requestAccounts' })) as Address[]
  const chainHex = numberToHex(qieMainnet.id)
  // Compare numerically: QIE Wallet returns lowercase '0x7c6' (guide, Step 3 note).
  if (Number.parseInt(String(await eth.request({ method: 'eth_chainId' })), 16) !== qieMainnet.id) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] })
    } catch (e) {
      // Only an unknown chain (4902) is added; a rejection (4001) or any other error goes back to the caller.
      if ((e as { code?: number })?.code !== 4902) throw e
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

/** Official QIE Wallet download (the guide asks for an install prompt, not a silent failure). */
export const QIE_WALLET_URL = 'https://qiewallet.me'
