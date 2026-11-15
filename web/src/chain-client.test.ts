import { describe, expect, it, vi } from 'vitest'

// The app's client delegates each call to viem's tree-shakable action, with the client as the first argument.
const actions = vi.hoisted(() => {
  const names = ['readContract', 'getBlock', 'getBlockNumber', 'getContractEvents', 'getLogs', 'simulateContract', 'estimateContractGas', 'waitForTransactionReceipt'] as const
  return Object.fromEntries(names.map((n) => [n, vi.fn(async (_c: unknown, a: unknown) => ({ called: n, a }))])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>
})
vi.mock('viem/actions', () => actions)

import { client, clientFor, writeActions, type Deployment } from './chain'

const FORK: Deployment = { id: 'fork', label: 'Fork', address: '0x2f4646D52a5393E239f5b880411dC2CA2D945F31', deployBlock: 1, chainId: 1990, rpc: 'http://127.0.0.1:8545' }

describe('the app client (reads bundled, write calls loaded on first use)', () => {
  it.each(Object.keys(actions))('%s goes to the viem action with the client and the arguments', async (name) => {
    for (const c of [client, clientFor(FORK)]) {
      const args = { tag: name }
      const out = await (c as unknown as Record<string, (a: unknown) => Promise<unknown>>)[name](args)
      expect(out).toEqual({ called: name, a: args })
      const [cl, a] = actions[name as keyof typeof actions].mock.calls.at(-1)!
      expect(a).toBe(args)
      expect((cl as { chain: { id: number } }).chain.id).toBe(1990)
    }
  })

  it('loads the write calls as their own module', async () => {
    const w = await writeActions()
    expect(w.simulateContract).toBe(actions.simulateContract)
    expect(w.estimateContractGas).toBe(actions.estimateContractGas)
    expect(w.waitForTransactionReceipt).toBe(actions.waitForTransactionReceipt)
  })
})
