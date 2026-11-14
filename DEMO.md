# Patungan demo and reproduction

**Status: live on QIE mainnet** (chain 1990). Contract [`0x2f4646D52a5393E239f5b880411dC2CA2D945F31`](https://mainnet.qie.digital/address/0x2f4646D52a5393E239f5b880411dC2CA2D945F31#code),
source verified on Blockscout. The gas and benchmark sections further down were measured on a local anvil fork of QIE mainnet or on mocks;
the full mainnet run (every tx, gas, QIE spent) is in [`evidence/mainnet-golive.md`](evidence/mainnet-golive.md).

## Mainnet transactions

| Outcome | Pool | Tx hash | Gas |
|---|---|---|---|
| Deploy + verify | n/a | [`0x78090ff8afbdd9bce055a9ddbaaf8f6fa0b7d8e7486e673820746fa9a7d3c9ce`](https://mainnet.qie.digital/tx/0x78090ff8afbdd9bce055a9ddbaaf8f6fa0b7d8e7486e673820746fa9a7d3c9ce) | 3,001,620 |
| PAID (last seat pays the payee in one tx) | 1 | [`0x4bd5c37de92855d3993a88698543c9d7c51dccde97f0fcd8d484450cd359a7a0`](https://mainnet.qie.digital/tx/0x4bd5c37de92855d3993a88698543c9d7c51dccde97f0fcd8d484450cd359a7a0) | 267,557 |
| REFUNDED (deadline passed, members refunded) | 2 | [`0x7886eba210a403a13e808b236a02c53564684f25332bb7b2db67ebcc8cd69f0a`](https://mainnet.qie.digital/tx/0x7886eba210a403a13e808b236a02c53564684f25332bb7b2db67ebcc8cd69f0a) | 155,766 |

Both demo pools pay `qkulk75527.qie`, the builder's own name (no real seller yet). Every member wallet in them is a builder wallet.

Builder-wallet pools are labelled "builder wallet". They are not users, and distinct wallets are not distinct people.

## Reproduce

```sh
git submodule update --init --recursive
forge test -vv            # 74 tests; 24 of them (8 Patungan fork + 16 spike) read live QIE mainnet state (QUSDC, QIEDEX, Zone, Oracle)
cd web && npm ci && npm test && npm run build     # 210 web tests
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

Pool page, join sheet, PAID stamp, refund state: `evidence/e2e-local/`. Create form and share sheet: `evidence/e2e-create/`. These fork runs were recorded before the UI copy moved to English, so their screenshots show the earlier Indonesian labels; the current English screens are `web/public/shots/` (PAID and REFUNDED from the live mainnet pools).
