# Patungan

> Group payments with a deadline. Everyone chips in, or everyone gets their money back. Built for QIE mainnet.

[![Contract verified on QIE mainnet](https://img.shields.io/badge/QIE%20mainnet-verified%20contract-2ea44f)](https://mainnet.qie.digital/address/0x2f4646D52a5393E239f5b880411dC2CA2D945F31#code) [![Live app](https://img.shields.io/badge/live-patungan.edycu.dev-1f6feb)](https://patungan.edycu.dev)

![Architecture](docs/architecture.svg)

## 20-second proof

1. An organizer opens a pool: seats × price in **QUSDC**, a deadline, and a payee (a `.qie` name or an address).
2. Members join paying QUSDC, or **QIE that the contract swaps to QUSDC through QIEDEX in the same transaction**.
3. The **last seat pays the payee in that same transaction** (the pool reads PAID).
4. If the deadline passes first, or the organizer cancels, **every member takes their QUSDC back**.

> **Status: live on QIE mainnet.** Contract [`0x2f4646D52a5393E239f5b880411dC2CA2D945F31`](https://mainnet.qie.digital/address/0x2f4646D52a5393E239f5b880411dC2CA2D945F31#code) (chain 1990, source verified on Blockscout, deploy block 11,895,948).
> Two builder demo pools ran on mainnet: one PAID (last seat paid in QIE paid the payee in the same tx) and one REFUNDED (deadline passed,
> every member refunded). Tx hashes: [`DEMO.md`](DEMO.md) and [`evidence/mainnet-golive.md`](evidence/mainnet-golive.md).
> Live app: https://patungan.edycu.dev · fork and mock evidence: [`evidence/core-flow.md`](evidence/core-flow.md).

## The four QIE components it runs on

All four are live on QIE mainnet (chain id 1990, explorer https://mainnet.qie.digital/) and Patungan's write paths are tested against their real state (forge fork tests and `script/local-flow.sh`).

| Component | Role in Patungan | Mainnet address |
|---|---|---|
| QUSDC | the escrow token (`transferFrom` in, transfer out) | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` |
| QIEDEX router (+ WQIE/QUSDC pair `0x73a3ccf7da7e473ed2e9994ae764f0e30f4e4dfe`) | swaps the member's QIE to QUSDC inside `joinWithQIE` | `0x08cd2e72e156D8563B4351eb4065C262A9f553Ef` |
| Zone `.qie` names | resolves the payee name (`domainOwnerByName`) | `0x9aab56e7727af53A3131985BFB16d845319b7bdc` |
| QIE Oracle (QIE/USDT feed, read as USD) | bounds what the swap may cost against the Oracle's fair value; `view` reads only | `0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17` |

The QIEDEX router's source is not verified on the explorer; Patungan calls it through the standard V2 router interface and bounds the result with the Oracle.

## Numbers (all from [`evidence/`](evidence/))

| What | Result | Source |
|---|---|---|
| Contract tests (`forge test`) | 71 passed: 47 on mocks (42 unit, 4 fuzz, 1 invariant suite of 3 properties); 24 read live mainnet state (8 Patungan fork, 16 day-one spike) | `evidence/forge-test-run.txt` |
| Web tests (`npm test`) | 40 passed | `evidence/web-test-run.txt` |
| Mutation check | 5 of 5 injected bugs caught | `evidence/mutation-run.txt` |
| Last-seat `joinWithQIE` (swap + payout), fork | 267,557 gas | `evidence/local-flow-run.txt` |
| QIE join vs Oracle fair value, 12 joins on a fork | median +564 bps (guard 1,500 bps) | `evidence/bench.md` |
| Browser click-through | join, PAID, cancel and refund, deadline and refund, on a fork | `evidence/e2e-local-run.txt` |
| Last-seat `joinWithQIE` (swap + payout), **mainnet** | 267,557 gas, Success | `evidence/mainnet-golive.md` |
| Deploy, **mainnet** | 3,001,620 gas (0.0030 QIE at 1 gwei) | `evidence/mainnet-golive.md` |

QIE blocks take about 3.6 s (Blockscout `/api/v2/stats` average_block_time = 3616 ms on 2026-11-14).

## Honest limits

- The only mainnet pools so far are the builder's two demo pools. Their member wallets are builder wallets, labelled as such in the app; they are not users. The PAID pool paid the builder's own name `qkulk75527.qie`, not a real seller.
- Unless marked mainnet, the numbers above ran on a fork or mocks.
- Distinct wallets are not distinct people. Any usage count we publish counts wallets.
- QUSDC has an issuer-controlled `VAULT_ROLE`; if the issuer burns escrowed QUSDC, the pool cannot make everyone whole. Patungan refuses new joins while insolvent (`isSolvent()` exposes the check); it has no admin key of its own.

## Layout

- `src/Patungan.sol`: the escrow (one contract holds every pool). `src/interfaces/`: the QIE component interfaces.
- `test/`: unit tests on mocks, fuzz, invariants, `fork/` (live mainnet state), `spike/`, `mocks/`, `utils/`.
- `script/`: `deploy-mainnet.sh`, `seed-demo.py`, `local-flow.sh`, `bench.py`, `mutation-check.sh`, `e2e-local.py`, `e2e-create.py`, `export-abi.sh`, `fork-gas.sh`, `mainnet-probe.sh`.
- `web/`: the app (Vite + TypeScript + viem): pool page, `/new`, `/verify`.
- `.github/workflows/ci.yml`: forge fmt + build + tests, web tests + build.
- `evidence/`: raw run outputs and their summaries.

## Run

```sh
git submodule update --init --recursive
forge test -vv                    # forks QIE mainnet through the public RPC (override with QIE_RPC_URL)
cd web && npm ci && npm test && npm run build
```

## Dependencies

OpenZeppelin Contracts v5.7.0, forge-std v1.17.0, viem 2.x, Vite 8, TypeScript 5. Standard libraries used as dependencies, not forked code.

## License

MIT, see [LICENSE](LICENSE).
