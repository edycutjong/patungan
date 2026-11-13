# Day-one spike: four QIE components on a fork of QIE mainnet

Date: 2026-11-13. Fork of QIE mainnet (chain 1990) at block 11879734, from the public RPC `https://rpc1mainnet.qie.digital/`.
Every write ran on a local fork against real mainnet state. **No mainnet transaction was sent for this spike.**

Reproduce:

```sh
git submodule update --init --recursive
forge test --match-path 'test/spike/*' -vv      # QIE_RPC_URL is optional; the suite also passed against rpc2..rpc5mainnet
```

The tests fork the **latest** block, so a re-run logs a different block, Oracle age and quote. The numbers below come from the
stored run at block 11879734. `test_oracle_latestRoundData_isLiveAndFresh` also fails if the live feed is ever more than 48 h old
when the suite runs, which is the same condition that disables the QIE path.

Raw output: [`fork-spike-run.txt`](fork-spike-run.txt). Test file: [`test/spike/Spike.fork.t.sol`](../test/spike/Spike.fork.t.sol).
Spike contract: [`test/spike/SpikeEscrow.sol`](../test/spike/SpikeEscrow.sol). This is a test-only contract. The product
contract (`src/Patungan.sol`) is not written yet.

## Result: 16 / 16 fork tests pass

| QIE component | Address | What the fork tests prove |
|---|---|---|
| QIE Oracle, QIE/USDT feed (read as QIE/USD) | `0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17` | `latestRoundData()` returns a positive answer with 8 decimals, younger than the 48 h guard. `latestAnswer()` reverts on this feed, so it is never called. A stale feed makes the QIE path revert `OracleStale`. |
| Zone `.qie` names | `0x9aab56e7727af53A3131985BFB16d845319b7bdc` | `domainOwnerByName("test","qie")` resolves a real existing name. `domainExistsByName` returns false for `TEST`, `test.qie` and tld `.qie`: only a lowercase label with the tld passed separately matches. An unknown name reverts, so creating a pool for it reverts. |
| QIEDEX router + WQIE/QUSDC pair | router `0x08cd2e72e156D8563B4351eb4065C262A9f553Ef`, pair `0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe` | The factory maps WQIE/QUSDC to the live pair. `swapETHForExactTokens` from a wallet spends exactly the `getAmountsIn` quote and returns the rest. |
| QUSDC | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | It has 6 decimals. Members bought QUSDC through QIEDEX, then approve + `transferFrom` moved it into escrow. The last seat paid the full pot to the payee resolved from the `.qie` name in the same tx. A paid pool then rejects new joins and refunds. After the deadline of an unfilled pool, both members got a QUSDC refund, including the one who paid in QIE. A second refund attempt reverts for each of them. |

**Contract-origin swap path:** the escrow contract is the `msg.sender` to the router. It receives the unspent QIE in `receive()` (which rejects any sender other than the router) and forwards it to the member. In the test, the member's net cost equals the router's input exactly, the escrow keeps 0 QIE, and the last-seat payout happens in the same tx.

## Measured on the fork

| Measure | Value | Source |
|---|---|---|
| QIE/USD from the Oracle | 0.15466603 (age 26,533 s ≈ 7.4 h at block 11879734) | `fork-spike-run.txt` |
| QIE in for one 0.25 QUSDC seat (router `getAmountsIn`) | 1.705131047102392564 QIE | `fork-spike-run.txt` |
| Oracle-fair QIE for the same seat | 1.616385964002567339 QIE | `fork-spike-run.txt` |
| Router premium over the Oracle | 549 bps, inside the 1,500 bps guard. With the Oracle mocked to 2× the price, `joinWithQIE` reverts `PriceDeviation`. The check runs before the swap call (`SpikeEscrow.sol`, `joinWithQIE`). | `fork-spike-run.txt` |

Transaction gasUsed, from real transactions on an anvil fork at block 11879716 ([`script/fork-gas.sh`](../script/fork-gas.sh); output in
[`fork-gas-run.txt`](fork-gas-run.txt); addresses impersonated, no keys; gas follows anvil's EVM rules, not a mainnet receipt):

| Transaction | gasUsed |
|---|---|
| deploy SpikeEscrow | 1,282,715 |
| `createByName` (resolves a `.qie` name) | 97,042 |
| `join` with QUSDC, seat 1 of 2 | 81,934 |
| `joinWithQIE`, last seat (swap + forward unspent QIE + pay the payee) | 204,743 |

## Mainnet checks (read-only, no spend)

[`script/mainnet-probe.sh`](../script/mainnet-probe.sh), output in [`mainnet-probe-run.txt`](mainnet-probe-run.txt):

- **Opcodes:** `eth_call` probes show QIE mainnet accepts PUSH0 (Shanghai) and rejects MCOPY and TSTORE (Cancun: "opcode 0x5e / 0x5d not defined"). That is why `foundry.toml` sets `evm_version = "shanghai"`.
- **Deploy simulation:** the spike contract's constructor, run on mainnet with `eth_call` from the deployer address, returned 5,656 bytes of runtime code. `eth_estimateGas` for the deploy returned 1,282,313. These checks run only the constructor, not the runtime code. The runtime code is compiled for the Shanghai target and ran in the fork tests above. No transaction was broadcast.
