# Patungan demo and reproduction

**Status: mainnet deployment pending.** Every number below was measured on a local anvil fork of QIE mainnet (chain 1990) or on
mocks. There is no Patungan contract on mainnet yet, so the mainnet transaction table is empty and is filled after deployment.

## Mainnet transactions

| Outcome | Pool | Tx hash | Explorer |
|---|---|---|---|
| Deploy + verify | n/a | pending | pending |
| PAID (last seat pays the payee in one tx) | pending | pending | pending |
| REFUNDED (deadline passed, members refunded) | pending | pending | pending |

Builder-wallet pools are labelled "builder wallet". They are not users, and distinct wallets are not distinct people.

## Reproduce

```sh
git submodule update --init --recursive
forge test -vv            # 71 tests; 24 of them (8 Patungan fork + 16 spike) read live QIE mainnet state (QUSDC, QIEDEX, Zone, Oracle)
cd web && npm ci && npm test && npm run build     # 33 web tests
script/mutation-check.sh  # 5 injected bugs, all must be caught
script/local-flow.sh      # deploy + seed on an anvil fork, prints the receipts
python3 script/bench.py   # gas and swap-cost tables (header of the file lists the setup)
```

Read-only checks against real mainnet: `script/mainnet-probe.sh`. Browser click-throughs: `script/e2e-local.py`, `script/e2e-create.py`.

## Gas (receipts on a fork; fork state moves, so a re-run can differ by a few thousand gas)

| Transaction | gasUsed | Source |
|---|---|---|
| deploy Patungan | 3,002,560 | `evidence/local-flow-run.txt` |
| createPool (address payee) | 128,973 | same |
| createPoolByName (.qie resolve) | 177,664 | same |
| join, QUSDC (first seat) | 182,829 | same |
| joinWithQIE (middle seat) | 248,372 | same |
| joinWithQIE (last seat, pays the payee) | 267,557 | same |
| claimRefund (one member) | 95,422 | same |
| refundAll (2 refunded, 1 skipped) | 120,539 | same |

p50 / p95 over repeated calls: `evidence/bench.md` (for example createPool p50 128,841 / p95 145,941; joinWithQIE any p50 237,800 / p95 248,372).

## Slippage (QIE joins, bench on a fork)

12 QIE joins paid a median of +564 bps over the Oracle's fair value for the same QUSDC (min +549, max +580). The paid amount matched
the router quote (+0.00%). The deployed guard allows up to 1,500 bps; the constructor cap is 2,000. Table: `evidence/bench.md`.

## Screens

Pool page, join sheet, PAID stamp, refund state: `evidence/e2e-local/`. Create form and share sheet: `evidence/e2e-create/`.
