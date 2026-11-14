/** Test helper: real ABI-encoded Patungan event logs, so the pages parse them exactly as they parse chain data. */
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem'
import { patunganAbi } from '../patungan-abi'

type EventName = 'PoolCreated' | 'Joined' | 'PoolPaid' | 'Refunded' | 'PoolCancelled' | 'RefundFailed'

export function encodeLog(
  address: Address,
  eventName: EventName,
  args: Record<string, unknown>,
  tx: Hex,
  block: bigint,
): { address: Address; topics: Hex[]; data: Hex; transactionHash: Hex; blockNumber: bigint } {
  const ev = patunganAbi.find((x) => x.type === 'event' && x.name === eventName) as { inputs: readonly { name: string; type: string; indexed?: boolean }[] }
  const indexed = Object.fromEntries(ev.inputs.filter((i) => i.indexed).map((i) => [i.name, args[i.name]]))
  const plain = ev.inputs.filter((i) => !i.indexed)
  const topics = encodeEventTopics({ abi: patunganAbi, eventName, args: indexed } as never) as Hex[]
  const data = encodeAbiParameters(plain as never, plain.map((i) => args[i.name]) as never)
  return { address, topics, data, transactionHash: tx, blockNumber: block }
}

export const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex
export const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address

/** Resolves on the next macrotask, after every pending microtask chain has settled. */
export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
}
