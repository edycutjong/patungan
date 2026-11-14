# Patungan for judges

Live page: https://patungan.edycu.dev/judge

**A group payment where the last seat pays the seller in the same transaction, and a missed deadline refunds everyone.**

Live on QIE mainnet: contract [`0x2f4646D52a5393E239f5b880411dC2CA2D945F31`](https://mainnet.qie.digital/address/0x2f4646D52a5393E239f5b880411dC2CA2D945F31#code)
(chain 1990, source verified on Blockscout). No wallet needed anywhere on this path: every page is a read-only call.

## The 30-second path

1. **Open the [PAID pool](https://patungan.edycu.dev/p/mainnet-1/1)** (PAID IN FULL). 2 of 2 seats at 0.25 QUSDC. The last seat paid in QIE: one
   transaction swapped QIE to QUSDC on QIEDEX, took the seat and paid 0.50 QUSDC to `qkulk75527.qie`:
   [`0x4bd5c37d…a7a0`](https://mainnet.qie.digital/tx/0x4bd5c37de92855d3993a88698543c9d7c51dccde97f0fcd8d484450cd359a7a0).
2. **Open the [REFUNDED pool](https://patungan.edycu.dev/p/mainnet-1/2)** (REFUNDED). 3 of 6 seats paid, the deadline passed, and one `refundAll`
   returned 0.75 QUSDC to all 3 members: [`0x7886eba2…0f0a`](https://mainnet.qie.digital/tx/0x7886eba210a403a13e808b236a02c53564684f25332bb7b2db67ebcc8cd69f0a).
3. **Check the [verified source on the explorer](https://mainnet.qie.digital/address/0x2f4646D52a5393E239f5b880411dC2CA2D945F31#code)**, or open
   [/verify](https://patungan.edycu.dev/verify): it reads solvency, the pool count and the four QIE components (QUSDC, QIEDEX router, Zone `.qie`
   names, QIE Oracle) live from the contract.
4. **Start your own pool at [/new](https://patungan.edycu.dev/new)**. Only this step asks for a wallet (QIE Wallet preferred, any EIP-1193 wallet works).

## Receipt

| What | Value |
|---|---|
| Mainnet transactions | 20, all success on Blockscout (deploy, 2 pools, 5 seats, 1 refundAll, plus wallet funding, swaps, approvals): [`evidence/mainnet-golive.md`](evidence/mainnet-golive.md) |
| Deploy | block 11,895,948, 3,001,620 gas, tx [`0x78090ff8…c9ce`](https://mainnet.qie.digital/tx/0x78090ff8afbdd9bce055a9ddbaaf8f6fa0b7d8e7486e673820746fa9a7d3c9ce) |
| Last seat in QIE (swap + seat + payout, one tx) | 267,557 gas on mainnet |
| QIE out of the deployer | 20.003668 QIE: 20 funded five builder wallets, 0.003668 was gas |
| Contract tests | 74 passed (unit, fuzz, invariants, and mainnet-fork tests on the real QUSDC, QIEDEX, Zone and Oracle); `src/` coverage 100% lines, statements, branches and functions |
| Web tests | 210 unit tests at 100% coverage, plus Playwright end-to-end tests against live mainnet reads |
| Mutation check | 5 of 5 injected bugs caught |

## Reproduce

```sh
git clone --recurse-submodules https://github.com/edycutjong/patungan.git && cd patungan
forge test -vv        # forks QIE mainnet through the public RPC, no keys
cd web && npm ci && npm test && npm run build
```

## Honest limits

- Both mainnet pools are the builder's demo pools: every member wallet is a builder wallet (labelled in the app), not a user, and the PAID pool
  paid the builder's own name `qkulk75527.qie`, not a real seller.
- No real group has used it on mainnet yet. Gas and price-guard numbers other than the ones marked mainnet were measured on a fork.
- QUSDC has an issuer-controlled `VAULT_ROLE`. If the issuer burns escrowed QUSDC, a pool cannot make everyone whole; Patungan then refuses new
  joins (`isSolvent()`) and has no admin key of its own.

## Links

[Live app](https://patungan.edycu.dev/pools) · [Repository](https://github.com/edycutjong/patungan) · [Pitch deck](https://patungan.edycu.dev/pitch/) · [Releases](https://github.com/edycutjong/patungan/releases/latest)
