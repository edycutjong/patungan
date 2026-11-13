/**
 * The pool page, /p/<deployment>/<id>: a kuitansi (receipt) with one ruled row per seat. Readable with no wallet;
 * a wallet joins (QIE or QUSDC), claims a refund, refunds everyone, or (organizer) cancels.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  erc20Abi,
  maxUint256,
  type Address,
  type Hash,
} from 'viem'
import { ADDR, clientFor, explorerAddress, explorerTx, hasExplorer, loadDeployments, type Deployment } from './chain'
import {
  fmtLeft,
  fmtQie,
  fmtQusdc,
  fmtWib,
  poolKind,
  canJoin,
  qieOffer,
  revertSentence,
  shortAddr,
  statusLine,
  terbilangQusdc,
  type PoolKind,
} from './format'
import { GAS_DRIP_WEI, isAddress, isBadChecksum } from './create-logic'
import { ageHours } from './names'
import { oracleAbi } from './abi'
import { patunganAbi } from './patungan-abi'
import { connect, hasWallet, metamaskDeepLink, walletFor } from './wallet'

const POLL_MS = 4_000 // ≈ one QIE block (~3.6 s)
const REFUND_CHUNK = 25n
const QUOTE_FRESH_S = 60 // chain seconds: an older rendered QIE quote is re-read before paying (leaves ≥ 4 min of the 5 min expiry)
const QUOTE_TTL_S = 300 // joinWithQIE expiry = the quote's block time + 5 min

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface PoolData {
  organizer: Address
  payee: Address
  price: bigint
  deadline: bigint
  seats: number
  filled: number
  status: number
  held: bigint
  title: string
  payeeName: string
  memberCount: number
  refunded: number
  members: { addr: Address; seats: number; owed: bigint }[]
  refundable: boolean
  /** Chain time: the latest block's timestamp plus the seconds elapsed since it was read (never the device clock). */
  blockNumber: bigint
  solvent: boolean // isSolvent() at the same block: joins revert Insolvent while false
  blockTs: number
  fetchedAt: number
  now: number
}

const LOG_CHUNK = 10_000n // blocks per eth_getLogs call; the mainnet RPC limit is measured in the P1c bench

interface Activity {
  joins: Map<string, { n: number; qie: boolean; tx: Hash }[]>
  paidTx?: Hash
  refunds: Map<string, Hash>
}

export async function renderPool(root: HTMLElement, depId: string, poolId: bigint) {
  const dep = (await loadDeployments()).find((d) => d.id === depId)
  if (!dep) {
    root.innerHTML = `<section class="notice"><h1>Unknown deployment</h1><p>No Patungan deployment called “${esc(depId)}”. <a href="/pools">All pools</a></p></section>`
    return
  }
  const page = new PoolPage(root, dep, poolId)
  await page.start()
}

class PoolPage {
  private client
  private data?: PoolData
  private activity: Activity = { joins: new Map(), refunds: new Map() }
  private logsFailed = false
  private scanning = false
  private rescanQueued = false
  private lastScanned?: bigint
  private account?: Address
  private lastKind?: PoolKind
  private maxDevBps = 1500
  private busy = false
  private guardRead = false
  private appliedBlock = -1n // a slower, older refresh never paints over a newer one
  private sheetSession = 0 // bumped on every open and close: work started for an earlier sheet never touches a later one
  private msg = ''
  private sheet!: HTMLDialogElement
  private polls = 0

  constructor(
    private root: HTMLElement,
    private dep: Deployment,
    private id: bigint,
  ) {
    this.client = clientFor(dep)
  }

  async start() {
    this.root.innerHTML = `<article class="kuitansi" aria-busy="true"><div class="perf"></div><div class="sheet" id="card">${skeleton()}</div></article>`
    this.sheet = document.createElement('dialog')
    this.sheet.className = 'joinsheet'
    this.sheet.addEventListener('close', () => void ++this.sheetSession)
    document.body.append(this.sheet)
    await this.ensureGuard().catch(() => undefined) // a failed read is retried by the QIE tab; polling starts anyway
    if (hasWallet()) {
      const accts = (await window.ethereum!.request({ method: 'eth_accounts' }).catch(() => [])) as Address[]
      this.account = accts[0]
      window.ethereum!.on?.('accountsChanged', (a: Address[]) => {
        this.account = a[0]
        void this.refresh()
      })
    }
    await this.refresh()
    void this.loadActivity()
    setInterval(() => {
      if (++this.polls % 5 === 0) void this.loadActivity()
      void this.refresh()
    }, POLL_MS)
  }

  // ------------------------------------------------------------------ reads
  /** The deployed Oracle guard (an immutable), read once. */
  private async ensureGuard() {
    if (this.guardRead) return
    this.maxDevBps = Number(
      await this.client.readContract({ address: this.dep.address, abi: patunganAbi, functionName: 'maxDevBps' }),
    )
    this.guardRead = true
  }

  private async read(): Promise<PoolData | undefined> {
    const c = this.client
    // Every read is pinned to one block, so the pool, its members and the clock always agree.
    const block = await c.getBlock()
    const at = { address: this.dep.address, abi: patunganAbi, blockNumber: block.number } as const
    const [[pool, title, payeeName, memberCount, refunded, refundable], [addrs, seats, owed], solvent] = await Promise.all([
      c.readContract({ ...at, functionName: 'getPool', args: [this.id] }),
      c.readContract({ ...at, functionName: 'getMembers', args: [this.id, 0n, maxUint256] }), // the contract clamps the range
      c.readContract({ ...at, functionName: 'isSolvent' }),
    ])
    if (pool.organizer === '0x0000000000000000000000000000000000000000') return undefined
    return {
      organizer: pool.organizer,
      payee: pool.payee,
      price: pool.price,
      deadline: BigInt(pool.deadline),
      seats: pool.seats,
      filled: pool.filled,
      status: pool.status,
      held: pool.held,
      title,
      payeeName,
      memberCount: Number(memberCount),
      refunded: Number(refunded),
      members: addrs.map((a, i) => ({ addr: a, seats: seats[i], owed: owed[i] })),
      refundable,
      blockNumber: block.number,
      solvent,
      blockTs: Number(block.timestamp),
      fetchedAt: Date.now() / 1000,
      now: Number(block.timestamp),
    }
  }

  /** Tx links come from logs, loaded after first paint; nothing the first paint needs depends on them. */
  private async loadActivity() {
    if (this.scanning) {
      this.rescanQueued = true // never stack scans on the public RPCs; run once more when this one ends
      return
    }
    this.scanning = true
    try {
      const args = { id: this.id }
      const latest = await this.client.getBlockNumber()
      const start = this.lastScanned === undefined ? BigInt(this.dep.deployBlock) : this.lastScanned + 1n
      const joined = []
      const paidLogs = []
      const refunded = []
      // bounded ranges: public RPCs cap eth_getLogs spans
      // incremental: after the first full scan, only the blocks since the last one
      for (let from = start; from <= latest; from += LOG_CHUNK) {
        const range = { address: this.dep.address, abi: patunganAbi, fromBlock: from, toBlock: from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest } as const
        const [j, p, r] = await Promise.all([
          this.client.getContractEvents({ ...range, eventName: 'Joined', args }),
          this.client.getContractEvents({ ...range, eventName: 'PoolPaid', args }),
          this.client.getContractEvents({ ...range, eventName: 'Refunded', args }),
        ])
        joined.push(...j)
        paidLogs.push(...p)
        refunded.push(...r)
      }
      const a = this.activity
      for (const l of joined) {
        const m = l.args.member!.toLowerCase()
        a.joins.set(m, [...(a.joins.get(m) ?? []), { n: Number(l.args.n), qie: !!l.args.paidWithQIE, tx: l.transactionHash }])
      }
      a.paidTx ??= paidLogs[0]?.transactionHash
      for (const l of refunded) a.refunds.set(l.args.member!.toLowerCase(), l.transactionHash)
      this.lastScanned = latest
      this.logsFailed = false
      this.paint()
    } catch {
      // logs are optional: the roster and state come from getPool/getMembers; say so instead of failing silently.
      // A failed chunk is retried from the last fully scanned block on the next call (nothing is merged twice).
      this.logsFailed = true
      this.paint()
    } finally {
      this.scanning = false
      if (this.rescanQueued) {
        this.rescanQueued = false
        void this.loadActivity()
      }
    }
  }

  private async refresh() {
    try {
      const d = await this.read()
      if (!d) {
        this.root.innerHTML = `<section class="notice"><h1>Pool #${this.id} not found</h1><p>Pool #${this.id} doesn't exist on this Patungan deployment. <a href="/pools">All pools</a></p></section>`
        return
      }
      if (d.blockNumber < this.appliedBlock) return
      this.appliedBlock = d.blockNumber
      this.data = d
      this.paint()
    } catch (e) {
      if (!this.data) this.setMsg("QIE's RPCs aren't answering. Retrying every few seconds.")
      console.warn(e)
    }
  }

  // ------------------------------------------------------------------ paint
  private paint() {
    const d = this.data
    const card = this.root.querySelector<HTMLElement>('#card')
    if (!d || !card) return
    d.now = Math.floor(d.blockTs + Math.max(0, Date.now() / 1000 - d.fetchedAt))
    const kind = poolKind(d, d.now)
    const land = this.lastKind !== undefined && this.lastKind !== kind && (kind === 'paid' || kind === 'refunded')
    this.lastKind = kind
    const payee = d.payeeName ? `${esc(d.payeeName)}.qie` : shortAddr(d.payee)
    const total = d.price * BigInt(d.seats)
    const me = this.account?.toLowerCase()
    const builders = new Set((this.dep.builderWallets ?? []).map((a) => a.toLowerCase()))

    card.parentElement!.removeAttribute('aria-busy')
    card.innerHTML = `
      ${this.dep.rpc ? `<p class="localnote">Local test chain (anvil fork of QIE mainnet). Not mainnet; amounts are test data.</p>` : ''}
      <div class="topline">
        <p class="label">Kuitansi patungan <i>· group payment</i> <span class="data">#${this.id}</span></p>
        ${this.account ? `<span class="data acct" title="${this.account}">${shortAddr(this.account)}</span>` : hasWallet() ? `<button class="link" data-act="connect">Connect wallet</button>` : ''}
      </div>
      <h1>${esc(d.title) || `Pool #${this.id}`}</h1>
      <p class="label">Untuk pembayaran <i>· pays</i></p>
      <p class="payee">${payee} ${d.payeeName ? `<span class="data">${shortAddr(d.payee)}</span>` : ''}</p>
      <div class="row2">
        <div class="amount">${fmtQusdc(d.price)} QUSDC<small>per seat · ${fmtQusdc(total)} QUSDC in total</small></div>
        <div class="counter" aria-label="${d.filled} of ${d.seats} seats paid">${d.filled}<span>/</span>${d.seats}</div>
      </div>
      <p class="terbilang"><span class="label">Terbilang</span> ${terbilangQusdc(d.price)} per kursi</p>
      <p class="deadline">closes ${fmtWib(d.deadline)} · ${fmtLeft(d.deadline, d.now)}</p>
      <p class="status" role="status">${esc(statusLine(d, d.now))}</p>
      ${this.stamp(kind, d, payee, land)}
      <ol class="roster">${this.rows(d, kind, me, builders)}</ol>
      ${this.logsFailed ? '<p class="data">Transaction links unavailable right now (the RPC refused the log query). Seats and state above are read directly from the contract.</p>' : ''}
      <div class="actions">${this.actions(kind, d, me)}</div>
      <p class="msg" aria-live="polite">${this.msg}</p>
      <footer class="data">
        Contract ${hasExplorer(this.dep) ? `<a href="${explorerAddress(this.dep.address)}" target="_blank" rel="noopener">${this.dep.address}</a>` : this.dep.address}
        · ${esc(this.dep.label)} · organizer ${shortAddr(d.organizer)}
      </footer>`
    card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => void this.act(b.dataset.act!)
    })
    this.paintDrip(card, kind, d, me)
  }

  /**
   * F13, organizer only while the pool is open: send 0.02 QIE (gas only, never seat money) to a member's address.
   * It lives outside #card so the 4 s repaint never wipes what is being typed.
   */
  private paintDrip(card: HTMLElement, kind: PoolKind, d: PoolData, me: string | undefined) {
    const box = this.root.querySelector<HTMLElement>('#drip')
    const want = kind === 'open' && d.now < Number(d.deadline) && !!me && me === d.organizer.toLowerCase()
    if (!want) return void box?.remove()
    if (box) return
    const el = document.createElement('div')
    el.id = 'drip'
    el.className = 'sheet dripbox'
    el.innerHTML = `<p class="label">Kirim gas <i>· Send 0.02 QIE for gas</i></p>
      <p class="note">For a member who has no QIE for the network fee. It is gas only: the seat money is the member's own, in QIE or QUSDC.</p>
      <div class="drip"><input aria-label="Member address" placeholder="0x… member address" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="cta ghost" type="button">Send 0.02 QIE</button></div><p class="msg" aria-live="polite"></p>`
    card.insertAdjacentElement('afterend', el)
    const input = el.querySelector('input')!
    const btn = el.querySelector('button')!
    const out = el.querySelector<HTMLElement>('.msg')!
    btn.onclick = async () => {
      const to = input.value.trim()
      const lower = to.toLowerCase()
      if (isAddress(to) && (lower === '0x0000000000000000000000000000000000000000' || lower === this.dep.address.toLowerCase() || lower === d.organizer.toLowerCase()))
        return void (out.textContent = "That address can't receive gas from here (zero address, the Patungan contract, or your own wallet). Paste a member's address.")
      if (!isAddress(to))
        return void (out.textContent = isBadChecksum(to) ? "That address doesn't pass its checksum (the capital letters are off). Copy it again." : 'Paste the member\'s 0x address (42 characters).')
      btn.disabled = true
      try {
        const account = await this.ensureAccount()
        if (account.toLowerCase() !== d.organizer.toLowerCase()) throw new Error('NotOrganizerWallet')
        out.textContent = 'Confirm in your wallet…'
        const hash = await walletFor(account).sendTransaction({ to: to as Address, value: GAS_DRIP_WEI })
        out.innerHTML = `Sent, waiting for a QIE block… ${this.txLink(hash)}`
        const r = await this.client.waitForTransactionReceipt({ hash })
        out.innerHTML = r.status === 'success' ? `✓ Sent 0.02 QIE for gas to ${shortAddr(to)}. ${this.txLink(hash)}` : 'The transfer reverted.'
      } catch (e) {
        out.textContent = e instanceof Error && e.message === 'NotOrganizerWallet' ? "The connected wallet is not this pool's organizer. Switch to the organizer wallet." : e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError) ? 'You cancelled in the wallet. Nothing was sent.' : 'Could not send the QIE. Nothing moved except, if it was mined, the network fee.'
      } finally {
        btn.disabled = false
      }
    }
  }

  private txLink(hash?: Hash, text?: string) {
    if (!hash) return ''
    const t = text ?? `tx ${hash.slice(0, 10)}…`
    return hasExplorer(this.dep)
      ? `<a class="data tx" href="${explorerTx(hash)}" target="_blank" rel="noopener">${t}</a>`
      : `<span class="data tx" title="${hash}">${t}</span>`
  }

  private stamp(kind: PoolKind, d: PoolData, payee: string, land: boolean) {
    const cls = land ? ' land' : ''
    if (kind === 'paid')
      return `<div class="stampwrap"><div class="stamp lunas${cls}" aria-hidden="true">LUNAS<small>PAID IN FULL</small></div>
        <p class="paidline">✓ Paid in full: ${fmtQusdc(d.price * BigInt(d.seats))} QUSDC to ${payee} ${this.txLink(this.activity.paidTx, 'payout tx')}</p></div>`
    if (kind === 'refunded')
      return `<div class="stampwrap"><div class="stamp kembali${cls}" aria-hidden="true">DIKEMBALIKAN<small>REFUNDED</small></div>
        <p class="paidline">✓ Everyone was refunded: ${d.memberCount} member${d.memberCount === 1 ? '' : 's'}, ${fmtQusdc(d.price * BigInt(d.filled))} QUSDC</p></div>`
    if (kind === 'cancelled')
      return `<div class="stampwrap"><div class="stamp batal" aria-hidden="true">DIBATALKAN<small>CANCELLED</small></div></div>`
    return ''
  }

  private rows(d: PoolData, kind: PoolKind, me: string | undefined, builders: Set<string>) {
    const out: string[] = []
    let n = 0
    const refundPhase = kind === 'refunds-open' || kind === 'partly-refunded' || kind === 'refunded'
    for (const m of d.members) {
      const key = m.addr.toLowerCase()
      const refunded = refundPhase && m.owed === 0n
      // one row per seat; with logs loaded, each seat carries its own join tx and its own "paid in QIE" tag
      const joins = this.activity.joins.get(key) ?? []
      const perSeat: ({ qie: boolean; tx: Hash; first: boolean } | undefined)[] = joins.flatMap((j) =>
        Array.from({ length: j.n }, (_, i) => ({ qie: j.qie, tx: j.tx, first: i === 0 })),
      )
      for (let s = 0; s < m.seats; s++) {
        n++
        const seat = perSeat[s]
        const tick = refunded ? 'REFUNDED' : kind === 'paid' ? 'PAID' : 'HELD'
        const link = refunded ? (s === 0 ? this.txLink(this.activity.refunds.get(key), 'refund tx') : '') : seat?.first ? this.txLink(seat.tx) : ''
        out.push(`<li class="${refunded ? 'refunded' : ''}">
          <span class="n">${n}</span>
          <span class="who"><span class="data">${shortAddr(m.addr)}</span>${key === me ? ' <b>(you)</b>' : ''}${seat?.qie ? '<span class="tag">paid in QIE</span>' : ''}${builders.has(key) ? '<span class="tag builder">builder wallet</span>' : ''}
            ${link}</span>
          <span class="tick">${tick}</span></li>`)
      }
    }
    for (; n < d.seats; ) out.push(`<li class="empty"><span class="n">${++n}</span><span class="who">kursi kosong · open seat</span><span></span></li>`)
    return out.join('')
  }

  private actions(kind: PoolKind, d: PoolData, me: string | undefined) {
    const dis = this.busy ? ' disabled' : ''
    const mine = me ? d.members.find((m) => m.addr.toLowerCase() === me) : undefined
    const b: string[] = []
    if (kind === 'open' && d.now < Number(d.deadline)) {
      if (canJoin(kind, d.now, d.deadline, d.solvent))
        b.push(`<button class="cta" data-act="open-sheet"${dis}>Join · pay ${fmtQusdc(d.price)} QUSDC per seat</button>`)
      else b.push(`<p class="note">${esc(revertSentence('Insolvent', this.maxDevBps))}</p>`)
      if (me && me === d.organizer.toLowerCase()) b.push(`<button class="cta ghost" data-act="cancel"${dis}>Cancel pool (refunds open at once)</button>`)
    }
    if (kind === 'refunds-open' || kind === 'partly-refunded') {
      if (mine && mine.owed > 0n) b.push(`<button class="cta" data-act="claim"${dis}>Get my money back · ${fmtQusdc(mine.owed)} QUSDC</button>`)
      b.push(`<button class="cta ghost" data-act="refund-all"${dis}>Refund everyone (${d.memberCount - d.refunded} left)</button>`)
    }
    if (!hasWallet() && b.length) b.push(`<a class="cta ghost" href="${esc(metamaskDeepLink(location.href))}">Open in wallet app</a>`)
    return b.join('')
  }

  private setMsg(m: string) {
    this.msg = m
    const el = this.root.querySelector('.msg')
    if (el) el.innerHTML = m
  }

  // ------------------------------------------------------------------ writes
  /** Always the account the wallet returns now (connect() also switches/adds chain 1990), never a cached one. */
  private async ensureAccount(): Promise<Address> {
    const { account } = await connect()
    this.account = account
    return account
  }

  private async act(what: string) {
    if (what === 'open-sheet') return this.openSheet()
    if (this.busy) return
    try {
      if (what === 'connect') {
        await this.ensureAccount()
        return void this.refresh()
      }
      const account = await this.ensureAccount()
      const d = this.data!
      if (what === 'claim') await this.send(account, 'claimRefund', [this.id], 'Refund sent')
      if (what === 'cancel') await this.send(account, 'cancel', [this.id], 'Pool cancelled')
      if (what === 'refund-all') {
        for (let from = 0n; from < BigInt(d.memberCount); from += REFUND_CHUNK)
          await this.send(account, 'refundAll', [this.id, from, REFUND_CHUNK], 'Refunds sent')
      }
    } catch (e) {
      this.fail(e)
    }
  }

  /** Simulate first (a revert costs nothing and comes back as a sentence), then sign, then wait for the receipt. */
  private async send(
    account: Address,
    functionName: 'claimRefund' | 'cancel' | 'refundAll' | 'join' | 'joinWithQIE',
    args: readonly unknown[],
    done: string,
    value?: bigint,
  ) {
    this.busy = true
    this.paint()
    try {
      const call = { account, address: this.dep.address, abi: patunganAbi, functionName, args, value } as never
      const { request } = await this.client.simulateContract(call)
      // A wallet's own estimate can be exactly the gas used, and the QIE join's nested refund calls (router → Patungan
      // → member) then run out of gas under the 63/64 rule (seen on the fork). Send our estimate + 25%.
      const gas = ((await this.client.estimateContractGas(call)) * 5n) / 4n
      this.setMsg('Confirm in your wallet…')
      const hash = await walletFor(account).writeContract({ ...(request as object), gas } as never)
      this.setMsg(`Sent, waiting for a QIE block… ${this.txLink(hash)}`)
      const r = await this.client.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('Reverted')
      this.setMsg(`✓ ${done}. ${this.txLink(hash)}`)
    } finally {
      this.busy = false
      await this.refresh()
      void this.loadActivity()
    }
  }

  private fail(e: unknown) {
    this.busy = false
    let name: string | undefined
    if (e instanceof BaseError) {
      const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
      name = rev?.data?.errorName ?? (rev?.reason?.includes('EXCESSIVE_INPUT_AMOUNT') ? 'EXCESSIVE_INPUT_AMOUNT' : rev?.reason)
      if (e.walk((x) => x instanceof UserRejectedRequestError)) name = 'UserRejected'
    } else if (e instanceof Error && e.message === 'NoWallet') {
      return this.openSheet()
    }
    this.setMsg(esc(revertSentence(name, this.maxDevBps)))
    console.warn(e)
    this.paint()
  }

  // ------------------------------------------------------------------ join sheet
  private async openSheet() {
    const d0 = this.data
    if (!d0) return
    const s = this.sheet
    if (!hasWallet()) {
      s.innerHTML = `<form method="dialog">
        <h2>Join this pool</h2>
        <p>Paying needs a wallet on QIE mainnet. Two ways:</p>
        <ol class="ways"><li><a href="${esc(metamaskDeepLink(location.href))}">Open this page in your wallet app</a> (from WhatsApp, tap here).</li>
        <li>Install QIE Wallet or MetaMask, then open this link again.</li></ol>
        <button class="cta ghost">Close</button></form>`
      s.showModal()
      return
    }
    let n = 1
    let tab: 'qie' | 'qusdc' = 'qie'
    let gen = 0 // only the newest render may attach handlers (stepper clicks can overlap slow reads)
    s.innerHTML = '<p class="quote">Reading your wallet…</p>'
    if (!s.open) s.showModal()
    // A read or a wallet prompt still pending from an earlier opening of this dialog must never write into, bind
    // handlers on, or close a later one (e.g. a late QIE quote landing on a reopened sheet's Approve button).
    const session = ++this.sheetSession
    const active = () => s.open && session === this.sheetSession
    // Each render reads the page's latest poll, so a pool that filled, closed, was cancelled or went short while the sheet
    // was open shows the reason instead of a Pay button the contract would reject.
    const closedReason = (x: PoolData) =>
      !x.solvent ? revertSentence('Insolvent', this.maxDevBps)
        : canJoin(poolKind(x, x.now), x.now, x.deadline, x.solvent) && x.filled < x.seats ? undefined
          : revertSentence('PoolNotOpen', this.maxDevBps)
    const showClosed = (why: string) =>
      (s.innerHTML = `<form method="dialog"><h2>Join this pool</h2><p>${esc(why)}</p><button class="cta ghost">Close</button></form>`)
    const why0 = closedReason(d0)
    if (why0) return void showClosed(why0)
    // F9: QIE is the default only when the wallet can't already cover one seat in QUSDC
    if (this.account) {
      const bal = await this.client
        .readContract({ address: ADDR.qusdc, abi: erc20Abi, functionName: 'balanceOf', args: [this.account] })
        .catch(() => 0n)
      if (bal >= d0.price) tab = 'qusdc'
    }
    if (!active()) return
    const render = async () => {
      if (!active()) return
      const d = this.data ?? d0
      const why = closedReason(d)
      if (why) return void showClosed(why)
      const left = d.seats - d.filled
      n = Math.min(n, left)
      const my = ++gen
      const current = () => active() && my === gen
      const seats = n // the handlers below pay for the seat count this render showed, even if the stepper moves later
      const amount = d.price * BigInt(seats)
      s.innerHTML = `<form method="dialog" class="sheetform">
        <h2>Join · ${esc(d.title)}</h2>
        <div class="stepper"><span class="label">Seats</span>
          <button type="button" data-n="-1" aria-label="fewer seats"${n <= 1 ? ' disabled' : ''}>−</button>
          <output>${n}</output>
          <button type="button" data-n="1" aria-label="more seats"${n >= left ? ' disabled' : ''}>+</button>
          <span class="data">${fmtQusdc(amount)} QUSDC</span></div>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${tab === 'qie'}" data-tab="qie">Bayar pakai QIE · Pay with QIE</button>
          <button type="button" role="tab" aria-selected="${tab === 'qusdc'}" data-tab="qusdc">Pay with QUSDC</button>
        </div>
        <div class="tabbody">Reading the price…</div>
        <p class="note">If the pool doesn't fill, you get QUSDC back (not QIE).</p>
        <p class="sheetmsg" aria-live="polite"></p>
        <button class="cta ghost" value="close">Close</button>
      </form>`
      s.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) => {
        b.onclick = () => {
          n = Math.min(left, Math.max(1, n + Number(b.dataset.n)))
          void render()
        }
      })
      s.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
        b.onclick = () => {
          tab = b.dataset.tab as 'qie' | 'qusdc'
          void render()
        }
      })
      const body = s.querySelector<HTMLElement>('.tabbody')!
      const sheetMsg = (m: string) => {
        const el = s.querySelector<HTMLElement>('.sheetmsg')
        if (el) el.innerHTML = m
      }
      // One write at a time: the lock is taken before the wallet prompt, and every control in the sheet is disabled
      // until the write settles, so a double tap can't start a second purchase.
      const lock = (on: boolean) =>
        s.querySelectorAll<HTMLButtonElement>('[data-pay], [data-n], [data-tab]').forEach((b) => {
          if (on) {
            b.dataset.was = b.disabled ? '1' : '0' // unlocking restores this, e.g. "2 · Pay" stays off until approved
            b.disabled = true
          } else if (b.dataset.was !== undefined) {
            b.disabled = b.dataset.was === '1'
            delete b.dataset.was
          }
        })
      const run = async (fn: (a: Address) => Promise<'requote' | void>) => {
        if (this.busy) return
        this.busy = true
        lock(true)
        try {
          const a = await this.ensureAccount()
          if (!current()) return // closed while the wallet was connecting: start nothing
          const latest = this.data ?? d0
          if (closedReason(latest) || latest.seats - latest.filled < seats) return void (await render()) // shows why
          if ((await fn(a)) === 'requote') {
            if (!current()) return
            await render() // still holding the lock: the finally below releases it after the fresh quote is up
            if (current()) sheetMsg('That price was more than a minute old, so here is a fresh one. Check your max, then tap Pay again.')
            return
          }
          if (current()) s.close()
        } catch (e) {
          this.fail(e)
          if (current()) {
            lock(false)
            sheetMsg(this.msg)
          }
        } finally {
          this.busy = false
        }
      }
      if (tab === 'qie') {
        try {
          await this.ensureGuard()
          // One block for the quote, the Oracle round it was checked against, and the quote's age.
          const qb = await this.client.getBlock()
          if (!current()) return
          const [[qieIn, , maxAllowed], round] = await Promise.all([
            this.client.readContract({ address: this.dep.address, abi: patunganAbi, functionName: 'quoteQIE', args: [this.id, seats], blockNumber: qb.number }),
            this.client.readContract({ address: ADDR.oracle, abi: oracleAbi, functionName: 'latestRoundData', blockNumber: qb.number }),
          ])
          if (!current()) return
          const quoteTs = Number(qb.timestamp) // chain time, not the device clock
          const oracleLine = `Oracle price updated ${ageHours(round[3], quoteTs)} h ago.`
          const offer = qieOffer(qieIn, maxAllowed)
          if (!offer.ok) {
            // The contract would revert PriceDeviation: no button that can only fail. QUSDC stays one tab away.
            body.innerHTML = `<p class="quote">${esc(revertSentence('PriceDeviation', this.maxDevBps))}</p>
              <p class="note">QIEDEX quote ≈ ${fmtQie(qieIn)} QIE; the QIE Oracle guard (${this.maxDevBps / 100}%) allows at most ${fmtQie(maxAllowed)} QIE. ${oracleLine}</p>`
            return
          }
          const maxLine = offer.capped
            ? `your max ${fmtQie(offer.value)} QIE: the Oracle guard's cap, less than 1% over this quote.`
            : `your max ${fmtQie(offer.value)} QIE: 1% over this quote.`
          body.innerHTML = `<p class="quote"><b>≈ ${fmtQie(qieIn)} QIE</b> (QIEDEX quote) · ${maxLine}
            The QIE Oracle guard (${this.maxDevBps / 100}%) is the hard cap: ${fmtQie(maxAllowed)} QIE. ${oracleLine}</p>
            <button type="button" class="cta" data-pay="qie">Pay ${fmtQusdc(amount)} QUSDC in QIE · 1 transaction</button>
            <p class="note">Unused QIE comes back in the same transaction.</p>`
          body.querySelector<HTMLButtonElement>('[data-pay="qie"]')!.onclick = () =>
            void run(async (a) => {
              const now = Number((await this.client.getBlock()).timestamp)
              if (now > quoteTs + QUOTE_FRESH_S) return 'requote'
              const expiry = BigInt(quoteTs + QUOTE_TTL_S) // the quote the member saw expires, not the click
              await this.send(a, 'joinWithQIE', [this.id, seats, expiry], `Seat${seats > 1 ? 's' : ''} paid in QIE`, offer.value)
            })
        } catch (e) {
          const rev = e instanceof BaseError ? (e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null) : null
          if (!current()) return
          const why = rev ? revertSentence(rev.data?.errorName, this.maxDevBps) : "QIE's RPCs aren't answering right now. Close this and try again in a moment."
          body.innerHTML = `<p class="quote">${esc(why)}</p>`
        }
      } else {
        const acct = this.account
        let bal = 0n
        let allowance = 0n
        try {
          if (acct)
            [bal, allowance] = await Promise.all([
              this.client.readContract({ address: ADDR.qusdc, abi: erc20Abi, functionName: 'balanceOf', args: [acct] }),
              this.client.readContract({ address: ADDR.qusdc, abi: erc20Abi, functionName: 'allowance', args: [acct, this.dep.address] }),
            ])
        } catch {
          if (current()) body.innerHTML = `<p class="quote">QIE's RPCs aren't answering right now. Close this and try again in a moment.</p>`
          return
        }
        if (!current()) return
        const needApprove = allowance < amount
        body.innerHTML = `<p class="quote">${acct ? `This wallet holds ${fmtQusdc(bal)} QUSDC.` : 'Connect a wallet that holds QUSDC.'} Two steps: approve, then pay.</p>
          <button type="button" class="cta${needApprove ? '' : ' ghost'}" data-pay="approve"${needApprove ? '' : ' disabled'}>1 · Approve ${fmtQusdc(amount)} QUSDC</button>
          <button type="button" class="cta${needApprove ? ' ghost' : ''}" data-pay="join"${needApprove ? ' disabled' : ''}>2 · Pay ${fmtQusdc(amount)} QUSDC</button>`
        body.querySelector<HTMLButtonElement>('[data-pay="approve"]')!.onclick = () =>
          void (async () => {
            if (this.busy) return
            this.busy = true
            lock(true)
            try {
              const a = await this.ensureAccount()
              if (!current()) return
              sheetMsg('Confirm the approval in your wallet…')
              const hash = await walletFor(a).writeContract({ address: ADDR.qusdc, abi: erc20Abi, functionName: 'approve', args: [this.dep.address, amount] })
              await this.client.waitForTransactionReceipt({ hash })
              this.busy = false
              if (current()) void render()
            } catch (e) {
              this.fail(e)
              if (current()) {
                lock(false)
                sheetMsg(this.msg)
              }
            } finally {
              this.busy = false
            }
          })()
        body.querySelector<HTMLButtonElement>('[data-pay="join"]')!.onclick = () =>
          void run((a) => this.send(a, 'join', [this.id, seats], `Seat${seats > 1 ? 's' : ''} paid in QUSDC`))
      }
    }
    await render()
  }
}

function skeleton() {
  const rows = Array.from({ length: 5 }, (_, i) => `<li class="empty"><span class="n">${i + 1}</span><span class="who"></span><span></span></li>`).join('')
  return `<p class="label">Kuitansi patungan</p><h1 class="ghosttext">&nbsp;</h1><ol class="roster">${rows}</ol>`
}
