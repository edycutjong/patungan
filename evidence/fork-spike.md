# Day-one spike: four QIE components on a fork of QIE mainnet

Date: 2026-11-13. Fork of QIE mainnet (chain 1990) at block 11879615, from the public RPC `https://rpc1mainnet.qie.digital/`.
Every write ran on the local fork against real mainnet state. **No mainnet transaction was sent for this spike.**

Reproduce:

```sh
git submodule update --init --recursive
forge test --match-path 'test/spike/*' -vv      # QIE_RPC_URL is optional; rpc1..rpc5mainnet all work
```

Raw output: [`fork-spike-run.txt`](fork-spike-run.txt). Test file: [`test/spike/Spike.fork.t.sol`](../test/spike/Spike.fork.t.sol).
Spike contract (not the product contract): [`test/spike/SpikeEscrow.sol`](../test/spike/SpikeEscrow.sol).

## Result: 16 / 16 fork tests pass

| QIE component | Address | What the fork tests prove |
|---|---|---|
| QIE Oracle, QIE/USDT feed | `0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17` | `latestRoundData()` returns a positive answer with 8 decimals, younger than the 48 h guard. `latestAnswer()` reverts, so it is never called. A stale feed makes the QIE path revert `OracleStale`. |
| Zone `.qie` names | `0x9aab56e7727af53A3131985BFB16d845319b7bdc` | `domainOwnerByName("test","qie")` resolves a real existing name. Only lowercase labels with the tld passed separately match: `TEST`, `test.qie` and tld `.qie` all return false. An unknown name reverts, so creating a pool for it reverts. |
| QIEDEX router + WQIE/QUSDC pair | router `0x08cd2e72e156D8563B4351eb4065C262A9f553Ef`, pair `0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe` | The factory maps WQIE/QUSDC to the live pair. `swapETHForExactTokens` works from a wallet: it spends exactly the `getAmountsIn` quote and returns the rest. |
| QUSDC | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | It has 6 decimals. Members bought QUSDC through QIEDEX, then approve + `transferFrom` moved it into escrow. The last seat paid the full pot to the payee resolved from the `.qie` name, in the same tx. After the deadline, every member got a refund in QUSDC (including the one who paid in QIE), and nobody could claim twice. |

**Contract-origin swap path:** the escrow contract is the `msg.sender` to the router. It receives the unspent QIE in `receive()` (which accepts only the router) and forwards it to the member. The member's net cost equals the router's input exactly. The escrow keeps 0 QIE, and the last-seat payout happens in the same tx.

## Measured on the fork (block 11879615)

| Measure | Value |
|---|---|
| QIE/USD from the Oracle | 0.15466603 (age 26,104 s ≈ 7.3 h at the fork block) |
| QIE in for one 0.25 QUSDC seat (router `getAmountsIn`) | 1.705131047102392564 QIE |
| Oracle-fair QIE for the same seat | 1.616385964002567339 QIE |
| Router premium over the Oracle | 549 bps, inside the 1,500 bps guard. With the Oracle mocked to 2× the price, the guard reverts `PriceDeviation` before any swap. |
| Gas: last-seat `joinWithQIE` (swap + forward + payout) | 233,415 |

## Mainnet deployability (read-only, no spend)

The spike contract's creation code (solc 0.8.28, `evm_version = shanghai`, constructor args = the live addresses above) was
run with `eth_call` and `eth_estimateGas` against QIE mainnet from the deployer address. It returned 5,656 bytes of runtime
code, and the gas estimate was 1,282,325. So the bytecode contains no opcode QIE mainnet rejects. No transaction was broadcast.
