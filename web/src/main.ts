import '@fontsource-variable/anybody/wdth.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/red-hat-mono/400.css'
import './styles.css'
import { formatUnits } from 'viem'
import { ADDR, client, clientFor, loadDeployments } from './chain'
import { oracleAbi, routerAbi } from './abi'
import { fmtQusdc, poolKind } from './format'
import { ageHours } from './names'
import { patunganAbi } from './patungan-abi'
import { renderCreate } from './create'
import { renderPool } from './pool'
import { renderVerify } from './verify'
import { NOTHING_SENT, whenSlow } from './slow'

const app = document.querySelector<HTMLElement>('#app')!
const route = location.pathname.match(/^\/p\/([a-z0-9-]+)\/(\d+)\/?$/i)

const path = location.pathname.replace(/\/+$/, '')
let generation = 0 // a Retry re-renders the page; reads from an earlier render never write into the new one

if (route) {
  void renderPool(app, route[1], BigInt(route[2]))
} else if (path === '/new') {
  void renderCreate(app)
} else if (path === '/verify') {
  void renderVerify(app)
} else {
  void home()
}

const STAMP: Record<string, string> = {
  paid: 'PAID IN FULL',
  refunded: 'REFUNDED',
  cancelled: 'CANCELLED',
  open: 'OPEN',
  'refunds-open': 'CLOSED · refunds available',
  'partly-refunded': 'CLOSED · refunding',
  'closed-empty': 'CLOSED',
}

/** App home at /pools (the landing page is index.html at /): live QIE component reads + every pool on each known deployment, newest first. */
/** The pools line when QIE's RPCs fail or hang, with a Retry that re-runs every read on the page. */
function unreachable(ul: Element, label: string, listed = '') {
  ul.innerHTML = `${listed}<li class="data">${label}: not answering. ${NOTHING_SENT} <button class="link" data-act="retry">Retry</button></li>`
  ul.querySelector('[data-act="retry"]')!.addEventListener('click', () => void home())
}

async function home() {
  const gen = ++generation
  const live = () => gen === generation
  app.innerHTML = `<section class="home">
    <h1>Patungan</h1>
    <p class="lede">Group payments with a deadline, on QIE mainnet. The last seat pays the seller; a missed deadline refunds everyone.</p>
    <p class="homecta"><a class="cta" href="/new">Start a pool</a> <a class="link" href="/verify">Verify the contract →</a></p>
    <h2 class="label">Pools</h2><ul class="pools" id="pools"><li class="data">Reading…</li></ul>
    <h2 class="label">QIE mainnet, live</h2><dl id="status"></dl></section>`
  const listed = pools(live)
  whenSlow(listed, () => live() && unreachable(document.querySelector('#pools')!, 'QIE mainnet'))
  const row = (label: string, value: string) => {
    if (!live()) return
    const dl = document.querySelector('#status')!
    const dt = document.createElement('dt')
    const dd = document.createElement('dd')
    dt.textContent = label
    dd.textContent = value
    dl.append(dt, dd)
  }
  try {
    const [block, round, qieIn] = await Promise.all([
      client.getBlockNumber(),
      client.readContract({ address: ADDR.oracle, abi: oracleAbi, functionName: 'latestRoundData' }),
      client.readContract({
        address: ADDR.router,
        abi: routerAbi,
        functionName: 'getAmountsIn',
        args: [250_000n, [ADDR.wqie, ADDR.qusdc]],
      }),
    ])
    row('QIE mainnet block', block.toString())
    row('QIE/USDT (QIE Oracle)', `${formatUnits(round[1], 8)} USDT, updated ${ageHours(round[3], Date.now() / 1000)} h ago`)
    row('QIE for a 0.25 QUSDC seat (QIEDEX quote)', formatUnits(qieIn[0], 18))
  } catch (e) {
    row('QIE mainnet', `not answering (${String((e as Error).message).slice(0, 80)})`)
  }
}

async function pools(live: () => boolean) {
  const ul = document.querySelector('#pools')!
  const items: string[] = []
  const down: string[] = []
  for (const dep of await loadDeployments()) {
    try {
      const c = clientFor(dep)
      const [next, block] = await Promise.all([
        c.readContract({ address: dep.address, abi: patunganAbi, functionName: 'nextId' }),
        c.getBlock(),
      ])
      for (let id = next; id >= 1n && next - id < 10n; id--) {
        const [p, title, , mc, rc] = await c.readContract({ address: dep.address, abi: patunganAbi, functionName: 'getPool', args: [id] })
        const kind = poolKind(
          { status: p.status, seats: p.seats, filled: p.filled, deadline: BigInt(p.deadline), memberCount: Number(mc), refunded: Number(rc) },
          Number(block.timestamp),
        )
        const t = title.replace(/[&<>"']/g, '')
        items.push(`<li><a href="/p/${dep.id}/${id}"><b>${t || `Pool #${id}`}</b> <span class="data">${p.filled}/${p.seats} · ${fmtQusdc(p.price)} QUSDC</span>
          <span class="mini ${kind}">${STAMP[kind]}</span></a> <span class="data">${dep.rpc ? 'local fork' : dep.label}</span></li>`)
      }
    } catch {
      down.push(dep.label)
    }
  }
  if (!live()) return
  if (down.length) return unreachable(ul, down.join(', '), items.join(''))
  ul.innerHTML = items.join('') || '<li class="data">No pools yet. The mainnet contract is not deployed yet.</li>'
}
