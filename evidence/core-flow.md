# Core flow evidence (contract `src/Patungan.sol` + pool page)

Everything here ran on a **local anvil fork of QIE mainnet** or on mocks. **No Patungan contract is on mainnet yet**, so there
are no mainnet transaction hashes in this file. Fork runs fork the latest mainnet block at run time (real QUSDC, the live
QIEDEX router and WQIE/QUSDC pair, a real `.qie` name, the live QIE Oracle feed).

## Tests: `forge test` → `forge-test-run.txt`
| Suite | File | Result |
|---|---|---|
| Unit (mocks of QUSDC, QIEDEX, Zone, Oracle) | `test/Patungan.t.sol` | 39 passed |
| Fuzz: payout = price × seats for any split; refunds return exactly what was paid; Oracle quote math; QIE change | `test/Patungan.fuzz.t.sol` | 4 passed (256 runs each) |
| Invariants: QUSDC balance = `totalHeld` + direct donations; `totalHeld` = Σ `held`; `held` = Σ `paid` while open/cancelled; `price·filled` = `held` + refunded; a paid pool refunded nobody; payee got exactly the filled pools; no native QIE left | `test/invariant/PatunganInvariant.t.sol` | 3 invariants held (64 runs × 50 calls) |
| Patungan on a QIE mainnet fork | `test/fork/Patungan.fork.t.sol` | 8 passed |
| Day-one spike on a QIE mainnet fork | `test/spike/Spike.fork.t.sol` | 16 passed |

`forge test` reports 68 tests (it counts the invariant contract as one); `forge-test-run.txt` lists each.
Web: `npm test` (vitest) 16 passed (`web-test-run.txt`): pool states, amounts, terbilang, WIB deadline, revert sentences.

## Deliberate bugs: `script/mutation-check.sh` → `mutation-run.txt`
Four bugs injected one at a time into `src/Patungan.sol`; the local suite fails on each (4 of 4 caught):
refund balance not zeroed (double refund) · last seat never pays · Oracle guard loosened 2× · payout leaves `totalHeld` counted.

## Measured gas (transaction receipts on an anvil fork): `script/local-flow.sh` → `local-flow-run.txt`
| Transaction | gasUsed |
|---|---|
| deploy Patungan | 2,990,231 |
| createPoolByName (.qie resolve + title on-chain) | 177,664 |
| createPool (address payee) | 128,973 |
| join, QUSDC (first seat) | 182,672 |
| joinWithQIE (middle seat) | 246,961 |
| joinWithQIE (last seat, pays the payee in the same tx) | 255,574 |
| cancel (before the first join) | 32,930 |
| claimRefund (one member) | 95,422 |
| refundAll (2 members refunded, 1 skipped) | 120,539 |

Same run: the payee (owner of the real name `test.qie`) received 750,000 QUSDC units (3 × 0.25 QUSDC) in the last-seat
transaction; after the refunds the escrow held 500,000 units = `totalHeld` (the open pool's two seats); 0 native QIE in the contract.
Router premium over the Oracle at test time: 549 bps (`fork-patungan-run.txt`, `test_fork_quoteQIE_matchesRouterAndOracle`;
the fork follows the latest block, so this moves run to run; QIE block ≈ 11.88 M on 2026-11-14), inside the 1,500 bps
guard the tests and `local-flow.sh` deploy with (the constructor allows at most 2,000).

## Browser click-through: `script/e2e-local.py` → `e2e-local-run.txt`, screenshots in `e2e-local/`
Google Chrome (installed; Playwright `channel="chrome"`, version in the run file) driven by Playwright against the Vite dev server and the anvil fork; the page gets an injected EIP-1193 provider that
forwards to anvil (impersonated test accounts, no keys). Steps, all passed:
read a PAID pool with no wallet (LUNAS stamp, 3 rows, 2 "paid in QIE" tags) · no-wallet join opens the "how to join" sheet ·
join paying QIE (one tx) · last seat paid in QUSDC (approve, pay): the payee's balance rose by exactly 1,000,000 units in that
tx and the LUNAS stamp landed · organizer cancels a pool with a member, then "Refund everyone" → DIKEMBALIKAN · a pool
passes its deadline → "CLOSED, refunds available" → "Get my money back" → DIKEMBALIKAN · home lists every pool with its state.

Seen during development of the click-through (that failing run was not stored): with no gas limit from the page, the
`joinWithQIE` transaction was sent with a limit equal to its gas used and reverted out of gas; the router's refund to
Patungan and Patungan's refund to the member are nested calls. The page now sends its own estimate + 25%
(`web/src/pool.ts`, `send`).
