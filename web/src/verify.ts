/**
 * S4, /verify: what a juror checks. The contract address and its Blockscout "source verified" badge (live, API v2),
 * the four QIE components it calls, the contract's own solvency view, and the latest events with tx links.
 * Nothing here is a number we typed: every value is read from the chain or the explorer when the page opens.
 */
import { parseEventLogs, type Abi, type Address, type Hex } from 'viem'
import { ADDR, clientFor, explorerAddress, explorerTx, hasExplorer, loadDeployments, qieMainnet, type Deployment } from './chain'
import { fmtQusdc, shortAddr } from './format'
import { patunganAbi } from './patungan-abi'

const API = `${qieMainnet.blockExplorers.default.url}/api/v2`
const WATCH = ['PoolCreated', 'Joined', 'PoolPaid', 'Refunded'] as const
type Watched = (typeof WATCH)[number]
const LOG_CHUNK = 10_000n // measured RPC limit: evidence/rpc-log-range.txt
const FALLBACK_CHUNKS = 6 // newest 60,000 blocks (about 2.5 days) when the explorer API is unreachable

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface EventRow {
  name: Watched
  poolId: bigint
  who: string
  detail: string
  tx: Hex
  block: bigint
}

export interface Verified {
  isVerified: boolean | undefined
  partial?: boolean
  name?: string
  compiler?: string
  at?: string
}

/** Blockscout API v2 smart-contract record; undefined verified = the explorer could not be reached. */
export async function fetchVerified(address: string, f: typeof fetch = fetch): Promise<Verified> {
  try {
    const r = await f(`${API}/smart-contracts/${address}`)
    if (r.status === 404) return { isVerified: false }
    if (!r.ok) return { isVerified: undefined }
    const j = (await r.json()) as { is_verified?: boolean; is_partially_verified?: boolean; name?: string; compiler_version?: string; verified_at?: string }
    return { isVerified: !!j.is_verified, partial: !!j.is_partially_verified, name: j.name, compiler: j.compiler_version, at: j.verified_at }
  } catch {
    return { isVerified: undefined }
  }
}

function describe(l: { eventName: string; args: Record<string, unknown> }): Pick<EventRow, 'name' | 'poolId' | 'who' | 'detail'> | undefined {
  const a = l.args as Record<string, never>
  switch (l.eventName) {
    case 'PoolCreated':
      return { name: 'PoolCreated', poolId: a.id, who: a.organizer, detail: `${a.seats} seats × ${fmtQusdc(a.price)} QUSDC${a.payeeName ? ` → ${esc(String(a.payeeName))}.qie` : ''}` }
    case 'Joined':
      return { name: 'Joined', poolId: a.id, who: a.member, detail: `${a.n} seat${Number(a.n) === 1 ? '' : 's'} · ${fmtQusdc(a.amount)} QUSDC${a.paidWithQIE ? ' · paid in QIE' : ''}` }
    case 'PoolPaid':
      return { name: 'PoolPaid', poolId: a.id, who: a.payee, detail: `${fmtQusdc(a.total)} QUSDC to the payee` }
    case 'Refunded':
      return { name: 'Refunded', poolId: a.id, who: a.member, detail: `${fmtQusdc(a.amount)} QUSDC refunded` }
  }
}

/** Explorer first (one request gets the newest 50 logs of the contract), RPC chunks from the head as the fallback. */
async function latestEvents(dep: Deployment): Promise<{ rows: EventRow[]; source: string }> {
  const c = clientFor(dep)
  if (hasExplorer(dep)) {
    try {
      const r = await fetch(`${API}/addresses/${dep.address}/logs`)
      if (r.ok) {
        const j = (await r.json()) as { items: { topics: (Hex | null)[]; data: Hex; transaction_hash: Hex; block_number: number }[] }
        const logs = j.items.map((i) => ({ address: dep.address, topics: i.topics.filter(Boolean) as Hex[], data: i.data, transactionHash: i.transaction_hash, blockNumber: BigInt(i.block_number) }))
        return { rows: toRows(logs).slice(0, 20), source: 'Blockscout API v2' }
      }
    } catch {
      /* fall through to RPC */
    }
  }
  const head = await c.getBlockNumber()
  const rows: EventRow[] = []
  for (let i = 0n; i < BigInt(FALLBACK_CHUNKS) && rows.length < 20; i++) {
    const to = head - i * LOG_CHUNK
    const from = to - LOG_CHUNK + 1n
    if (to < BigInt(dep.deployBlock)) break
    const logs = await c.getLogs({ address: dep.address, fromBlock: from < BigInt(dep.deployBlock) ? BigInt(dep.deployBlock) : from, toBlock: to })
    rows.push(...toRows(logs as never))
  }
  return { rows: rows.slice(0, 20), source: `QIE RPC (newest ${FALLBACK_CHUNKS * 10_000} blocks)` }
}

function toRows(logs: { address: Address; topics: Hex[]; data: Hex; transactionHash: Hex; blockNumber: bigint }[]): EventRow[] {
  const parsed = parseEventLogs({ abi: patunganAbi as Abi, logs: logs as never, strict: false }) as unknown as {
    eventName: string
    args: Record<string, unknown>
    transactionHash: Hex
    blockNumber: bigint
  }[]
  return parsed
    .filter((l) => (WATCH as readonly string[]).includes(l.eventName))
    .map((l) => ({ ...describe(l)!, tx: l.transactionHash, block: l.blockNumber }))
    .sort((a, b) => Number(b.block - a.block))
}

export async function renderVerify(root: HTMLElement) {
  let deps: Deployment[] = []
  let loadFailed = false
  try {
    deps = await loadDeployments()
  } catch {
    loadFailed = true
  }
  root.innerHTML = `<section class="home verify"><div class="topline"><a class="link" href="/">← Patungan</a></div>
    <h1>Verify</h1>
    <p class="lede">What a juror can check in two minutes. The contract, its four components, solvency and the events below are read live from QIE mainnet and its explorer when the page opens. The notes at the bottom are static text.</p>
    <div id="vbody"><p class="data">Reading…</p></div>
    <h2 class="label">Honest notes</h2>
    <ul class="notes">
      <li>QIE blocks arrive about every 3.6 s (measured), not every 2 s.</li>
      <li>Distinct wallets are not distinct people: a roster counts wallets, not humans.</li>
      <li>Wallets the builders control are labelled "builder wallet" on every roster and never counted as users.</li>
      <li>The QIE Oracle is a sanity bound on the swap, not the price paid. The price paid is QIEDEX's.</li>
      <li>QUSDC is issued by QIE with a mint/burn role that sits outside Patungan. Patungan itself has no owner, pause, upgrade or withdraw.</li>
    </ul></section>`
  const body = root.querySelector<HTMLElement>('#vbody')!
  const comp = (label: string, addr: string) =>
    `<dt>${label}</dt><dd><a class="data" href="${explorerAddress(addr)}" target="_blank" rel="noopener">${addr}</a></dd>`
  const components = `<h2 class="label">The four QIE components it calls</h2><dl>
    ${comp('QUSDC (escrow token)', ADDR.qusdc)}${comp('QIEDEX Router (swap)', ADDR.router)}${comp('Zone (.qie names)', ADDR.zone)}${comp('QIE Oracle (QIE/USD feed)', ADDR.oracle)}</dl>`
  if (loadFailed) {
    body.innerHTML = '<p class="localnote">Could not load the deployment list. Reload the page.</p>'
    return
  }
  if (deps.length === 0) {
    body.innerHTML = `<p class="localnote">The Patungan contract is not deployed on QIE mainnet yet, so there is nothing to verify. The four components it will call are live:</p>${components}`
    return
  }
  const sections: string[] = []
  for (const dep of deps) sections.push(await deployment(dep).catch(() => `<h2 class="label">${esc(dep.label)}</h2><p class="data">Could not read this deployment right now.</p>`))
  body.innerHTML = sections.join('') + components
}

async function deployment(dep: Deployment): Promise<string> {
  const c = clientFor(dep)
  const link = hasExplorer(dep)
    ? `<a class="data" href="${explorerAddress(dep.address)}" target="_blank" rel="noopener">${dep.address}</a>`
    : `<span class="data">${dep.address}</span>`
  const [verified, events, solvency, wired] = await Promise.all([
    hasExplorer(dep) ? fetchVerified(dep.address) : Promise.resolve<Verified>({ isVerified: undefined }),
    latestEvents(dep).catch(() => undefined),
    Promise.all([
      c.readContract({ address: dep.address, abi: patunganAbi, functionName: 'isSolvent' }),
      c.readContract({ address: dep.address, abi: patunganAbi, functionName: 'totalHeld' }),
      c.readContract({ address: dep.address, abi: patunganAbi, functionName: 'nextId' }),
      c.readContract({ address: dep.address, abi: patunganAbi, functionName: 'maxDevBps' }),
    ]).catch(() => undefined),
    Promise.all(['qusdc', 'router', 'zone', 'oracle'].map((fn) => c.readContract({ address: dep.address, abi: patunganAbi, functionName: fn as 'qusdc' }))).catch(() => undefined),
  ])
  const badge = !hasExplorer(dep)
    ? '<span class="vbadge no">local test chain · no explorer</span>'
    : verified.isVerified === true
      ? `<span class="vbadge ${verified.partial ? 'no' : 'ok'}">${verified.partial ? 'Partially verified on Blockscout (metadata does not match)' : '✓ Source verified on Blockscout'}</span> <span class="data">${esc(verified.name ?? '')} · ${esc(verified.compiler ?? '')}${verified.at ? ` · ${esc(verified.at.slice(0, 10))}` : ''}</span>`
      : verified.isVerified === false
        ? '<span class="vbadge no">✗ Source NOT verified</span>'
        : '<span class="vbadge no">Explorer not reachable: could not check verification</span>'
  const rows =
    events?.rows
      .map((e) => {
        const tx = hasExplorer(dep) ? `<a class="data" href="${explorerTx(e.tx)}" target="_blank" rel="noopener">${e.tx.slice(0, 10)}…</a>` : `<span class="data">${e.tx.slice(0, 10)}…</span>`
        const pool = `<a href="/p/${dep.id}/${e.poolId}">#${e.poolId}</a>`
        return `<li><b>${e.name}</b> ${pool} <span class="data">${shortAddr(e.who)}</span> ${e.detail} ${tx}</li>`
      })
      .join('') ?? ''
  return `<h2 class="label">${esc(dep.label)}</h2>
    <p class="vaddr">${link}</p><p>${badge}</p>
    ${solvency ? `<dl><dt>Solvent (QUSDC balance ≥ held)</dt><dd>${solvency[0] ? 'yes' : 'NO'}</dd><dt>QUSDC held for open pools</dt><dd>${fmtQusdc(solvency[1])}</dd><dt>Pools created</dt><dd>${solvency[2]}</dd><dt>Oracle guard (maxDevBps)</dt><dd>${solvency[3]} (${Number(solvency[3]) / 100}%)</dd></dl>` : '<p class="data">Contract reads unavailable right now.</p>'}
    ${wired ? `<h3 class="label">Wired at deploy (read from the contract's immutables)</h3><dl><dt>QUSDC</dt><dd class="data">${wired[0]}</dd><dt>Router</dt><dd class="data">${wired[1]}</dd><dt>Zone</dt><dd class="data">${wired[2]}</dd><dt>Oracle</dt><dd class="data">${wired[3]}</dd></dl><p class="data">${[ADDR.qusdc, ADDR.router, ADDR.zone, ADDR.oracle].every((x, i) => x.toLowerCase() === String(wired[i]).toLowerCase()) ? 'These match the addresses linked below.' : 'These do NOT all match the addresses linked below.'}</p>` : ''}
    <h3 class="label">Latest events${events ? ` · via ${esc(events.source)}` : ''}</h3>
    ${events ? `<ul class="events">${rows || '<li class="data">No events yet.</li>'}</ul>` : '<p class="data">Events unavailable right now.</p>'}`
}

