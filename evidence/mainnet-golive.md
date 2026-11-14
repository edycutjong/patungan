# Mainnet go-live, 2026-11-14 (QIE mainnet, chain 1990)

Run from `build/` with `script/deploy-mainnet.sh`, then `script/seed-demo.py paid` and `script/seed-demo.py refund`
(`PAYEE_NAME=qkulk75527 PAYEE_ADDR=0x3e015c14AE36d81d73ACda34713122CC90Ec3cf7`). Every wallet below belongs to the builder.
None of them is a user. Every tx status was re-read from Blockscout (`/api/v2/transactions/<hash>`), and all show `success`.

## Contract

| What | Value |
|---|---|
| Patungan | [`0x2f4646D52a5393E239f5b880411dC2CA2D945F31`](https://mainnet.qie.digital/address/0x2f4646D52a5393E239f5b880411dC2CA2D945F31#code) |
| Source | verified on Blockscout, full match (`is_verified` true, `is_partially_verified` false), solc 0.8.28, shanghai, 200 runs |
| Deploy tx | [`0x78090ff8afbdd9bce055a9ddbaaf8f6fa0b7d8e7486e673820746fa9a7d3c9ce`](https://mainnet.qie.digital/tx/0x78090ff8afbdd9bce055a9ddbaaf8f6fa0b7d8e7486e673820746fa9a7d3c9ce), block 11,895,948, 3,001,620 gas |
| Constructor | QUSDC `0x3F43…5DA5`, QIEDEX router `0x08cd…53Ef`, Zone `0x9aab…7bdc`, Oracle `0x3Bc6…3D17`, maxDevBps 1500, maxOracleAge 172800 s |
| Deployer | `0x616F4e1d85D41F34330D3D0D167717c4015E69D7` (builder wallet) |
| Preflight | router quote 1.7051 QIE for 0.25 QUSDC; Oracle fair 1.6112 QIE (+582 bps, guard 1,500); Oracle age 1,567 s |

## Pool 1: PAID (last seat paid in QIE pays the payee in the same tx)

"Rehearsal PAID (builder wallets)": 2 seats × 0.25 QUSDC, payee `qkulk75527.qie` = `0x3e015c14AE36d81d73ACda34713122CC90Ec3cf7`
(the builder's own name; no real seller yet). The payee's QUSDC balance went 0 → 500000 units (0.50 QUSDC) in the last seat's tx.

| Step | Tx | Gas |
|---|---|---|
| fund builder wallet B1 `0xc7Fe…4BA1` with 4 QIE | [`0xf73bc2a6…d5f4`](https://mainnet.qie.digital/tx/0xf73bc2a6b2ff046f9902be06463f28613f0f80c891a7fb60ed793afd8324d5f4) | 21,000 |
| fund builder wallet B2 `0xE1b0…93dC` with 4 QIE | [`0xdab715bd…ba35`](https://mainnet.qie.digital/tx/0xdab715bd812fb72fa94b2c6c95dc4d3e5660055edc242b70349ab17a5579ba35) | 21,000 |
| `createPoolByName` pool 1 → qkulk75527.qie | [`0xf2f5f759…5129`](https://mainnet.qie.digital/tx/0xf2f5f75985bc05bed042dd5f3fe8319e5b9beec0eb1aa59fc24ecb0b40be5129) | 200,211 |
| B1 buys 0.25 QUSDC on QIEDEX | [`0x0d8838e1…4384`](https://mainnet.qie.digital/tx/0x0d8838e10c9eff438464d217ec6cfc7ff86c0321a0e45122a07a75ada9ab4384) | 127,746 |
| B1 approves QUSDC | [`0x302b5d78…669b`](https://mainnet.qie.digital/tx/0x302b5d78dd3c3f0abf9cdefcc815ca9f8e53b42f2742ebbe02edcdccf2d2669b) | 46,961 |
| B1 `join(1)` in QUSDC | [`0xf05a375b…ac43`](https://mainnet.qie.digital/tx/0xf05a375b2a550868b66e8370ee6b8c74f58afbab89cd86f467035df1bca4ac43) | 182,829 |
| **B2 `joinWithQIE(1)`: swap + last seat + payout, one tx** | [`0x4bd5c37de92855d3993a88698543c9d7c51dccde97f0fcd8d484450cd359a7a0`](https://mainnet.qie.digital/tx/0x4bd5c37de92855d3993a88698543c9d7c51dccde97f0fcd8d484450cd359a7a0) | 267,557 |

## Pool 2: REFUNDED (deadline passed, every member refunded)

"Badminton Saturday (builder wallets)": 6 seats × 0.25 QUSDC, 15-minute deadline, payee qkulk75527.qie. 3 of 6 seats paid, the
deadline passed, `refundAll` returned all three (`refundedCount` 3 of 3). Each builder wallet holds its 0.25 QUSDC again. `isSolvent()` true.

| Step | Tx | Gas |
|---|---|---|
| fund B1, B2, B3 `0x31Ec…aC70` with 4 QIE each | [`0xb5604ede…19c3`](https://mainnet.qie.digital/tx/0xb5604ede602035c584f98905d78ed4a07aa21bd25355da3de59d8f4fbea719c3), [`0xc9fa3e9e…8446`](https://mainnet.qie.digital/tx/0xc9fa3e9e10319d9a1ee206edc6937e334935eed642a6c9fec243a18755458446), [`0x8579aea9…c5c1`](https://mainnet.qie.digital/tx/0x8579aea9017395686cfb08217c6a20c1cffa7a7a9633b32ffd6a21de37d4c5c1) | 21,000 each |
| `createPoolByName` pool 2 → qkulk75527.qie | [`0xa73ec94b77aed88b6645feabb0e98909812eca8aa509beb143d2e15d934f5553`](https://mainnet.qie.digital/tx/0xa73ec94b77aed88b6645feabb0e98909812eca8aa509beb143d2e15d934f5553) | 205,702 |
| B1 buys 0.25 QUSDC, approves, `join(2)` | [`0x020fc5fb…2f3f`](https://mainnet.qie.digital/tx/0x020fc5fbd51ae3e6482e38d9899370b5d37aa61b5047e9ae9b3035ccf5433f2f), [`0x66d98402…9c8e`](https://mainnet.qie.digital/tx/0x66d98402b93ac7083edfa6f47184f57babcf227750ec8b54b0fbd13067fc9c8e), [`0xcc28fbab…c10e`](https://mainnet.qie.digital/tx/0xcc28fbab1e8a58c7bfe88045f35965f89215aaf738c27b6e7a03c56d4268c10e) | 127,746 / 46,961 / 182,829 |
| B2 buys 0.25 QUSDC, approves, `join(2)` | [`0xab8cb568…b667`](https://mainnet.qie.digital/tx/0xab8cb568299a6ca927960a968c107742a7a1da698e0ebac20eb036387388b667), [`0xcecff585…4002`](https://mainnet.qie.digital/tx/0xcecff585972d0f40d18f30f5046679f26d16ee12e94f1a213179448133c34002), [`0xe75876bb…1a52`](https://mainnet.qie.digital/tx/0xe75876bb0f6e9318339e49b580c79abe1d105ec6f5d29a496e34f85eb7291a52) | 127,746 / 46,961 / 131,529 |
| B3 `joinWithQIE(2)` | [`0x2f2ad045d5cf822cc32cbb242d88801dfc61e8445a854d69c0d090bf8b866cac`](https://mainnet.qie.digital/tx/0x2f2ad045d5cf822cc32cbb242d88801dfc61e8445a854d69c0d090bf8b866cac) | 248,372 |
| **`refundAll(2)`: 3 members refunded** | [`0x7886eba210a403a13e808b236a02c53564684f25332bb7b2db67ebcc8cd69f0a`](https://mainnet.qie.digital/tx/0x7886eba210a403a13e808b236a02c53564684f25332bb7b2db67ebcc8cd69f0a) | 155,766 |

## QIE spent

Gas price on every tx: 1.000000001 gwei. Spend cap: 80 QIE.

| | QIE |
|---|---|
| Deployer start balance | 80.000000 |
| Builder-wallet funding (5 × 4 QIE; the leftovers stay in those builder wallets) | 20.000000 |
| Deployer gas (deploy 3,001,620 + 5 fundings 105,000 + 2 creates + refundAll = 3,668,299 gas) | 0.003668 |
| **Out of the deployer** | **20.003668 of the 80 cap (25.0%)** |
| Deployer balance after | 59.996332 |
| Net consumed by the builder wallets (swaps for 5 seats = 1.25 QUSDC, plus their gas) | ≈ 8.53 |
