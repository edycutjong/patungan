/**
 * S3, /new: the organizer form. Live `.qie` resolve (the shown address is sent as `expectedPayee`, so the tx reverts
 * PayeeChanged if the name moves before it mines), then a share sheet (WhatsApp text + copy link) for the new pool.
 */
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, parseEventLogs, type Address } from 'viem'
import { ADDR, clientFor, explorerTx, hasExplorer, loadDeployments, type Deployment } from './chain'
import { zoneAbi } from './abi'
import { MAX_SEATS, MAX_TITLE_BYTES, MIN_SEATS, checkCreate, type CreateChecked, isAddress, isBadChecksum, shareText, unixToWib, whatsappLink } from './create-logic'
import { fmtQusdc, shortAddr } from './format'
import { toQieLabel } from './names'
import { patunganAbi } from './patungan-abi'
import { connect, hasWallet, walletFor } from './wallet'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

type Payee = { kind: 'address'; address: Address } | { kind: 'name'; label: string; address: Address }

export async function renderCreate(root: HTMLElement) {
  const deps = await loadDeployments()
  const dep: Deployment | undefined = deps[deps.length - 1]
  const client = dep ? clientFor(dep) : undefined
  const defaultDeadline = unixToWib(Math.floor(Date.now() / 1000) + 3 * 24 * 3600) // a suggestion only; chain time validates

  root.innerHTML = `<article class="kuitansi"><div class="perf"></div><section class="sheet">
    <div class="topline"><a class="link" href="/">← Patungan</a></div>
    <h1>Buat patungan<br><small class="sub">Start a pool</small></h1>
    ${dep ? (dep.rpc ? '<p class="localnote">Local test chain (an anvil fork of QIE mainnet). Not mainnet.</p>' : '') : '<p class="localnote">The Patungan contract is not deployed on QIE mainnet yet, so pools can\'t be created. Check back soon.</p>'}
    <form id="create" class="createform" novalidate>
      <label class="field"><span class="label">Untuk pembayaran <i>(what is it for · up to ${MAX_TITLE_BYTES} bytes)</i></span>
        <input name="title" maxlength="64" autocomplete="off" placeholder="Futsal Kamis" required><span class="err" aria-live="polite" data-err="title"></span></label>
      <div class="two">
        <label class="field"><span class="label">Kursi <i>(seats ${MIN_SEATS}–${MAX_SEATS})</i></span>
          <input name="seats" type="number" inputmode="numeric" min="${MIN_SEATS}" max="${MAX_SEATS}" value="5" required><span class="err" aria-live="polite" data-err="seats"></span></label>
        <label class="field"><span class="label">Harga per kursi <i>(QUSDC)</i></span>
          <input name="price" inputmode="decimal" autocomplete="off" placeholder="2" value="2" required><span class="err" aria-live="polite" data-err="price"></span></label>
      </div>
      <div class="two">
        <label class="field"><span class="label">Batas bayar <i>(deadline, WIB)</i></span>
          <input name="date" type="date" value="${defaultDeadline.date}" required></label>
        <label class="field"><span class="label">Jam <i>(WIB)</i></span>
          <input name="time" type="time" value="20:00" required></label>
      </div>
      <span class="err" aria-live="polite" data-err="deadline"></span>
      <label class="field"><span class="label">Penjual <i>(payee: a .qie name or a 0x address)</i></span>
        <input name="payee" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="lapangan.qie" required>
        <span class="resolve" aria-live="polite"></span><span class="err" aria-live="polite" data-err="payee"></span></label>
      <p class="note">The last seat pays the seller in the same transaction. If the pool doesn't fill by the deadline, each member can take their QUSDC back from the pool page (one tap, or anyone can refund everyone). No one holds the money in between: it sits in the Patungan contract.</p>
      <div class="actions"><button class="cta" type="submit"${dep ? '' : ' disabled'}>Buat patungan · Create pool</button></div>
      <p class="msg" aria-live="polite"></p>
    </form>
    <div id="shared"></div>
  </section></article>`

  const form = root.querySelector<HTMLFormElement>('#create')!
  const msg = root.querySelector<HTMLElement>('.msg')!
  const resolveEl = root.querySelector<HTMLElement>('.resolve')!
  const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value
  const setErr = (k: string, text: string) => {
    const el = form.querySelector<HTMLElement>(`[data-err="${k}"]`)
    if (el) el.textContent = text
  }
  let payee: Payee | undefined
  let resolveSeq = 0
  let resolveFailed = false
  let sentHash: string | undefined

  async function resolvePayee() {
    const seq = ++resolveSeq
    payee = undefined
    resolveFailed = false
    setErr('payee', '')
    const raw = val('payee').trim()
    if (!raw || !client) return void (resolveEl.textContent = '')
    if (isAddress(raw) && (/^0x0{40}$/.test(raw) || raw.toLowerCase() === dep!.address.toLowerCase()))
      return void (resolveEl.textContent = "✗ That address can't be the seller (the zero address or the Patungan contract).")
    if (isAddress(raw)) {
      payee = { kind: 'address', address: raw as Address }
      resolveEl.textContent = `✓ A plain address: ${shortAddr(raw)}. Make sure the seller can use QUSDC at this address.`
      return
    }
    if (isBadChecksum(raw)) return void (resolveEl.textContent = "✗ That address doesn't pass its checksum (the capital letters are off). Copy it again.")
    const label = toQieLabel(raw)
    if (!/^[a-z0-9-]{1,64}$/.test(label)) return void (resolveEl.textContent = '✗ Enter a .qie name (letters, digits, hyphens) or a 0x address.')
    resolveEl.textContent = `Looking up ${label}.qie …`
    try {
      const exists = await client.readContract({ address: ADDR.zone, abi: zoneAbi, functionName: 'domainExistsByName', args: [label, 'qie'] })
      if (seq !== resolveSeq) return
      if (!exists) return void (resolveEl.textContent = `✗ ${label}.qie is not registered.`)
      const owner = await client.readContract({ address: ADDR.zone, abi: zoneAbi, functionName: 'domainOwnerByName', args: [label, 'qie'] })
      if (seq !== resolveSeq) return
      payee = { kind: 'name', label, address: owner }
      resolveEl.textContent = `✓ ${label}.qie resolves to ${shortAddr(owner)}. The money goes to this address, fixed when the pool is created.`
    } catch {
      if (seq === resolveSeq) {
        resolveFailed = true
        resolveEl.textContent = "Couldn't reach the QIE name registry. Try again in a moment."
      }
    }
  }
  let t: ReturnType<typeof setTimeout> | undefined
  (form.elements.namedItem('payee') as HTMLInputElement).addEventListener('input', () => {
    clearTimeout(t)
    t = setTimeout(() => void resolvePayee(), 350)
  })

  form.addEventListener('input', (ev) => {
    const name = (ev.target as HTMLInputElement).name
    setErr(name, '')
    if (name === 'date' || name === 'time') setErr('deadline', '')
  })

  form.addEventListener('submit', (ev) => {
    ev.preventDefault()
    void submit()
  })

  function focusFirstError() {
    const key = form.querySelector<HTMLElement>('.err:not(:empty)')?.dataset.err
    ;(form.elements.namedItem(key === 'deadline' ? 'date' : (key ?? '')) as HTMLInputElement | null)?.focus()
  }

  /** While a tx is being prepared or signed, nothing in the form can change under it. */
  function lock(on: boolean) {
    Array.from(form.elements).forEach((el) => ((el as HTMLInputElement | HTMLButtonElement).disabled = on))
  }

  async function submit() {
    if (!dep || !client) return
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!
    msg.textContent = ''
    ;['title', 'seats', 'price', 'deadline', 'payee'].forEach((k) => setErr(k, ''))
    btn.disabled = true
    let created_ok = false
    try {
      if (!hasWallet()) throw new Error('NoWallet')
      lock(true)
      clearTimeout(t) // a pending debounced resolve must not clear the payee mid-submit
      await resolvePayee()
      const pay = payee
      const seats = Number(val('seats'))
      const title = val('title').trim()
      const priceText = val('price')
      const date = val('date')
      const time = val('time')
      const check = async () => {
        const block = await client.getBlock()
        const c: CreateChecked & { errors: Record<string, string | undefined> } = checkCreate({ title, seats, price: priceText, date, time, chainNow: Number(block.timestamp) })
        if (!pay && !resolveFailed && !resolveEl.textContent?.startsWith('✗')) c.errors.payee = 'Enter a .qie name that exists, or a 0x address.'
        return c
      }
      let c = await check()
      const bad = Object.entries(c.errors)
      if (bad.length || !pay) {
        bad.forEach(([k, v]) => setErr(k, v!))
        lock(false)
        focusFirstError()
        return
      }
      const { account } = await connect()
      c = await check() // chain time again: a slow wallet connect must not leave the deadline under the 10-minute floor
      if (Object.keys(c.errors).length) {
        Object.entries(c.errors).forEach(([k, v]) => setErr(k, v!))
        lock(false)
        return
      }
      const call =
        pay.kind === 'name'
          ? { functionName: 'createPoolByName', args: [pay.label, pay.address, c.price!, seats, c.deadline!, title] }
          : { functionName: 'createPool', args: [pay.address, c.price!, seats, c.deadline!, title] }
      const req = { account, address: dep.address, abi: patunganAbi, ...call } as never
      const { request } = await client.simulateContract(req)
      const gas = ((await client.estimateContractGas(req)) * 5n) / 4n
      msg.textContent = 'Confirm in your wallet…'
      const hash = await walletFor(account).writeContract({ ...(request as object), gas } as never)
      sentHash = hash
      msg.innerHTML = `Sent, waiting for a QIE block… ${txLink(dep, hash)}`
      const r = await client.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('Reverted')
      const created = parseEventLogs({ abi: patunganAbi, eventName: 'PoolCreated', logs: r.logs }).find((l) => l.address.toLowerCase() === dep.address.toLowerCase())
      if (!created) throw new Error('No PoolCreated event in the receipt')
      const id = created.args.id
      form.remove() // gone, not hidden: no second create tx from a stray tap
      created_ok = true
      share(dep, id, { title, seats, price: c.price!, deadline: c.deadline!, payeeLabel: pay.kind === 'name' ? `${pay.label}.qie` : shortAddr(pay.address) }, hash)
    } catch (e) {
      if (sentHash) {
        // The tx was signed and sent: it may still be pending or already mined. Never invite a second create.
        msg.innerHTML = `Your transaction was sent but we couldn't confirm it. ${txLink(dep, sentHash)} Check the explorer or <a href="/">the pool list</a> before trying again, or you may create the pool twice. <button class="link" type="button" data-reload>Start over</button>`
        msg.querySelector<HTMLButtonElement>('[data-reload]')!.onclick = () => location.reload()
        created_ok = true // keep the form locked
      } else {
        msg.textContent = createError(e)
        lock(false)
        focusFirstError()
      }
    } finally {
      if (!created_ok) btn.disabled = false
    }
  }

  function share(d: Deployment, id: bigint, p: { title: string; seats: number; price: bigint; deadline: number; payeeLabel: string }, hash: string) {
    const url = `${location.origin}/p/${d.id}/${id}`
    const text = shareText({ ...p, url })
    const box = root.querySelector<HTMLElement>('#shared')!
    box.innerHTML = `<p class="status">✓ Pool #${id} created. ${txLink(d, hash as `0x${string}`)}</p>
      <h2 class="label">Bagikan · Share</h2>
      <p class="status">${esc(p.title)} · ${p.seats} seats × ${fmtQusdc(p.price)} QUSDC</p>
      <pre class="sharetext">${esc(text)}</pre>
      <div class="actions">
        <a class="cta" href="${whatsappLink(text)}" target="_blank" rel="noopener">Kirim ke WhatsApp · Share on WhatsApp</a>
        <button class="cta ghost" type="button" data-copy>Salin tautan · Copy link</button>
        <a class="cta ghost" href="${url}">Open the pool page</a>
      </div>
      <p class="msg" id="copied" aria-live="polite"></p>
      `
    const copied = box.querySelector<HTMLElement>('#copied')!
    box.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url)
        copied.textContent = 'Link copied.'
      } catch {
        copied.textContent = `Copy this link by hand: ${url}`
      }
    }
  }
}

function txLink(dep: Deployment, hash: string) {
  const t = `tx ${hash.slice(0, 10)}…`
  return hasExplorer(dep) ? `<a class="data tx" href="${explorerTx(hash)}" target="_blank" rel="noopener">${t}</a>` : `<span class="data tx" title="${hash}">${t}</span>`
}

function createError(e: unknown): string {
  if (e instanceof Error && e.message === 'NoWallet') return 'Open this page in a wallet app (QIE Wallet or MetaMask) to create a pool.'
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return 'You cancelled in the wallet. Nothing was sent.'
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (rev instanceof ContractFunctionRevertedError) {
      switch (rev.data?.errorName) {
        case 'PayeeNotFound':
          return "That .qie name isn't registered."
        case 'PayeeChanged':
          return 'That .qie name just moved to another owner. Check the address shown and try again.'
        case 'PayeeInvalid':
          return "That address can't be the payee."
        case 'BadParams':
          return 'The contract rejected these values: check seats (2–100), the price, the title length and the deadline (10 minutes to 90 days from now).'
      }
    }
  }
  return 'Could not create the pool. Nothing moved except, if it was mined, the network fee.'
}
