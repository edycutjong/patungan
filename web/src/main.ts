import { formatUnits } from 'viem'
import { ADDR, client } from './chain'
import { oracleAbi, routerAbi, zoneAbi } from './abi'
import { ageHours } from './names'

const SEAT = 250_000n // 0.25 QUSDC, 6 decimals

function row(label: string, value: string) {
  const dl = document.querySelector<HTMLDListElement>('#status')!
  const dt = document.createElement('dt')
  const dd = document.createElement('dd')
  dt.textContent = label
  dd.textContent = value
  dl.append(dt, dd)
}

async function main() {
  const [block, round, qieIn, payee] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: ADDR.oracle, abi: oracleAbi, functionName: 'latestRoundData' }),
    client.readContract({
      address: ADDR.router,
      abi: routerAbi,
      functionName: 'getAmountsIn',
      args: [SEAT, [ADDR.wqie, ADDR.qusdc]],
    }),
    client.readContract({ address: ADDR.zone, abi: zoneAbi, functionName: 'domainOwnerByName', args: ['test', 'qie'] }),
  ])
  row('QIE mainnet block', block.toString())
  row('QIE/USD (QIE Oracle)', `$${formatUnits(round[1], 8)}, updated ${ageHours(round[3], Date.now() / 1000)} h ago`)
  row('QIE for a 0.25 QUSDC seat (QIEDEX quote)', formatUnits(qieIn[0], 18))
  row('test.qie resolves to', payee)
}

main().catch((e) => row('error', String(e?.shortMessage ?? e)))
