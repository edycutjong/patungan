/**
 * The pool page, /p/<deployment>/<id>: a kuitansi (receipt) with one ruled row per seat. Readable with no wallet;
 * a wallet joins (QIE or QUSDC), claims a refund, refunds everyone, or (organizer) cancels.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  erc20Abi,
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
  qieMaxValue,
  revertSentence,
  shortAddr,
  statusLine,
  terbilangQusdc,
  type PoolKind,
} from './format'
import { ageHours } from './names'
import { patunganAbi } from './patungan-abi'
import { connect, hasWallet, metamaskDeepLink, walletFor } from './wallet'

const POLL_MS = 4_000 // ≈ one QIE block (~3.6 s)
const REFUND_CHUNK = 25n

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
  now: number
}

interface Activity {
  joins: Map<string, { qie: boolean; tx: Hash }[]>
  paidTx?: Hash
  refunds: Map<string, Hash>
}

export async function renderPool(root: HTMLElement, depId: string, poolId: bigint) {
  const dep = (await loadDeployments()).find((d) => d.id === depId)
  if (!dep) {
    root.innerHTML = `<section class="notice"><h1>Unknown deployment</h1><p>No Patungan deployment called “${esc(depId)}”. <a href="/">Home</a></p></section>`
    return
  }
  const page = new PoolPage(root, dep, poolId)
  await page.start()
}

class PoolPage {
  private client
  private data?: PoolData
  private activity: Activity = { joins: new Map(), refunds: new Map() }
  private account?: Address
  private lastKind?: PoolKind
  private maxDevBps = 1500
  private busy = false
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
    document.body.append(this.sheet)
    this.maxDevBps = Number(
      await this.client.readContract({ address: this.dep.address, abi: patunganAbi, functionName: 'maxDevBps' }),
    )
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
  private async read(): Promise<PoolData | undefined> {
    const c = this.client
    const [[pool, title, payeeName, memberCount, refunded], block] = await Promise.all([
      c.readContract({ address: this.dep.address, abi: patunganAbi, functionName: 'getPool', args: [this.id] }),
      c.getBlock(),
    ])
    if (pool.organizer === '0x0000000000000000000000000000000000000000') return undefined
    const [addrs, seats, owed] = await c.readContract({
      address: this.dep.address,
      abi: patunganAbi,
      functionName: 'getMembers',
      args: [this.id, 0n, memberCount],
    })
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
      now: Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000) - 60),
    }
  }

  /** Tx links come from logs, loaded after first paint; nothing the first paint needs depends on them. */
  private async loadActivity() {
    try {
      const args = { id: this.id }
      const opts = { address: this.dep.address, abi: patunganAbi, fromBlock: BigInt(this.dep.deployBlock) } as const
      const [joined, paidLogs, refunded] = await Promise.all([
        this.client.getContractEvents({ ...opts, eventName: 'Joined', args }),
        this.client.getContractEvents({ ...opts, eventName: 'PoolPaid', args }),
        this.client.getContractEvents({ ...opts, eventName: 'Refunded', args }),
      ])
      const a: Activity = { joins: new Map(), refunds: new Map() }
      for (const l of joined) {
        const m = l.args.member!.toLowerCase()
        a.joins.set(m, [...(a.joins.get(m) ?? []), { qie: !!l.args.paidWithQIE, tx: l.transactionHash }])
      }
      a.paidTx = paidLogs[0]?.transactionHash
      for (const l of refunded) a.refunds.set(l.args.member!.toLowerCase(), l.transactionHash)
      this.activity = a
      this.paint()
    } catch {
      // logs are optional: the roster and state come from getPool/getMembers
    }
  }

  private async refresh() {
    try {
      const d = await this.read()
      if (!d) {
        this.root.innerHTML = `<section class="notice"><h1>Pool #${this.id} not found</h1><p>Pool #${this.id} doesn't exist on this Patungan deployment. <a href="/">Home</a></p></section>`
        return
      }
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
      <div class="actions">${this.actions(kind, d, me)}</div>
      <p class="msg" aria-live="polite">${this.msg}</p>
      <footer class="data">
        Contract ${hasExplorer(this.dep) ? `<a href="${explorerAddress(this.dep.address)}" target="_blank" rel="noopener">${this.dep.address}</a>` : this.dep.address}
        · ${esc(this.dep.label)} · organizer ${shortAddr(d.organizer)}
      </footer>`
    card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => void this.act(b.dataset.act!)
    })
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
      const joins = this.activity.joins.get(key) ?? []
      const qie = joins.some((j) => j.qie)
      const refunded = refundPhase && m.owed === 0n
      for (let s = 0; s < m.seats; s++) {
        n++
        const tick = refunded ? 'REFUNDED' : kind === 'paid' ? 'PAID' : 'HELD'
        out.push(`<li class="${refunded ? 'refunded' : ''}">
          <span class="n">${n}</span>
          <span class="who"><span class="data">${shortAddr(m.addr)}</span>${key === me ? ' <b>(you)</b>' : ''}${qie ? '<span class="tag">paid in QIE</span>' : ''}${builders.has(key) ? '<span class="tag builder">builder wallet</span>' : ''}
            ${s === 0 ? this.txLink(refunded ? this.activity.refunds.get(key) : joins[0]?.tx) : ''}</span>
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
    if (kind === 'open') {
      b.push(`<button class="cta" data-act="open-sheet"${dis}>Join · pay ${fmtQusdc(d.price)} QUSDC per seat</button>`)
      if (me && me === d.organizer.toLowerCase()) b.push(`<button class="cta ghost" data-act="cancel"${dis}>Cancel pool (refunds open at once)</button>`)
    }
    if (kind === 'refunds-open' || kind === 'partly-refunded') {
      if (mine && mine.owed > 0n) b.push(`<button class="cta" data-act="claim"${dis}>Get my money back · ${fmtQusdc(mine.owed)} QUSDC</button>`)
      b.push(`<button class="cta ghost" data-act="refund-all"${dis}>Refund everyone (${d.memberCount - d.refunded} left)</button>`)
    }
    if (!hasWallet() && b.length) b.push(`<a class="cta ghost" href="${metamaskDeepLink(location.href)}">Open in wallet app</a>`)
    return b.join('')
  }

  private setMsg(m: string) {
    this.msg = m
    const el = this.root.querySelector('.msg')
    if (el) el.innerHTML = m
  }

  // ------------------------------------------------------------------ writes
  private async ensureAccount(): Promise<Address> {
    if (this.account) {
      await connect() // also switches/adds chain 1990
      return this.account
    }
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
    const d = this.data
    if (!d) return
    const left = d.seats - d.filled
    const s = this.sheet
    if (!hasWallet()) {
      s.innerHTML = `<form method="dialog">
        <h2>Join this pool</h2>
        <p>Paying needs a wallet on QIE mainnet. Two ways:</p>
        <ol class="ways"><li><a href="${metamaskDeepLink(location.href)}">Open this page in your wallet app</a> (from WhatsApp, tap here).</li>
        <li>Install QIE Wallet or MetaMask, then open this link again.</li></ol>
        <button class="cta ghost">Close</button></form>`
      s.showModal()
      return
    }
    let n = 1
    let tab: 'qie' | 'qusdc' = 'qie'
    const render = async () => {
      const amount = d.price * BigInt(n)
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
      const sheetMsg = (m: string) => (s.querySelector<HTMLElement>('.sheetmsg')!.innerHTML = m)
      const run = async (fn: (a: Address) => Promise<void>) => {
        try {
          const a = await this.ensureAccount()
          await fn(a)
          s.close()
        } catch (e) {
          this.fail(e)
          sheetMsg(this.msg)
        }
      }
      if (tab === 'qie') {
        try {
          const [[qieIn, , maxAllowed], round] = await Promise.all([
            this.client.readContract({ address: this.dep.address, abi: patunganAbi, functionName: 'quoteQIE', args: [this.id, n] }),
            this.client.readContract({
              address: ADDR.oracle,
              abi: [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [
                { type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const,
              functionName: 'latestRoundData',
            }),
          ])
          const value = qieMaxValue(qieIn, maxAllowed)
          body.innerHTML = `<p class="quote"><b>≈ ${fmtQie(qieIn)} QIE</b> (QIEDEX quote) · your max ${fmtQie(value)} QIE: 1% over this quote.
            The QIE Oracle guard (${this.maxDevBps / 100}%) is the hard cap: ${fmtQie(maxAllowed)} QIE. Oracle price updated ${ageHours(round[3], d.now)} h ago.</p>
            <button type="button" class="cta" data-pay="qie">Pay ${fmtQusdc(amount)} QUSDC in QIE · 1 transaction</button>
            <p class="note">Unused QIE comes back in the same transaction.</p>`
          s.querySelector<HTMLButtonElement>('[data-pay]')!.onclick = () =>
            void run(async (a) => {
              const blockTs = Number((await this.client.getBlock()).timestamp)
              const expiry = BigInt(Math.max(blockTs, Math.floor(Date.now() / 1000)) + 300)
              await this.send(a, 'joinWithQIE', [this.id, n, expiry], `Seat${n > 1 ? 's' : ''} paid in QIE`, value)
            })
        } catch (e) {
          const rev = e instanceof BaseError ? (e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null) : null
          body.innerHTML = `<p class="quote">${esc(revertSentence(rev?.data?.errorName, this.maxDevBps))}</p>`
        }
      } else {
        const acct = this.account
        const [bal, allowance] = acct
          ? await Promise.all([
              this.client.readContract({ address: ADDR.qusdc, abi: erc20Abi, functionName: 'balanceOf', args: [acct] }),
              this.client.readContract({ address: ADDR.qusdc, abi: erc20Abi, functionName: 'allowance', args: [acct, this.dep.address] }),
            ])
          : [0n, 0n]
        const needApprove = allowance < amount
        body.innerHTML = `<p class="quote">${acct ? `This wallet holds ${fmtQusdc(bal)} QUSDC.` : 'Connect a wallet that holds QUSDC.'} Two steps: approve, then pay.</p>
          <button type="button" class="cta${needApprove ? '' : ' ghost'}" data-pay="approve"${needApprove ? '' : ' disabled'}>1 · Approve ${fmtQusdc(amount)} QUSDC</button>
          <button type="button" class="cta${needApprove ? ' ghost' : ''}" data-pay="join"${needApprove ? ' disabled' : ''}>2 · Pay ${fmtQusdc(amount)} QUSDC</button>`
        s.querySelector<HTMLButtonElement>('[data-pay="approve"]')!.onclick = () =>
          void (async () => {
            try {
              const a = await this.ensureAccount()
              sheetMsg('Confirm the approval in your wallet…')
              const hash = await walletFor(a).writeContract({ address: ADDR.qusdc, abi: erc20Abi, functionName: 'approve', args: [this.dep.address, amount] })
              await this.client.waitForTransactionReceipt({ hash })
              void render()
            } catch (e) {
              this.fail(e)
              sheetMsg(this.msg)
            }
          })()
        s.querySelector<HTMLButtonElement>('[data-pay="join"]')!.onclick = () =>
          void run((a) => this.send(a, 'join', [this.id, n], `Seat${n > 1 ? 's' : ''} paid in QUSDC`))
      }
    }
    if (!s.open) s.showModal()
    await render()
  }
}

function skeleton() {
  const rows = Array.from({ length: 5 }, (_, i) => `<li class="empty"><span class="n">${i + 1}</span><span class="who"></span><span></span></li>`).join('')
  return `<p class="label">Kuitansi patungan</p><h1 class="ghosttext">&nbsp;</h1><ol class="roster">${rows}</ol>`
}
