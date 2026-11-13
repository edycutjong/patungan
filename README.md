# Patungan

Group payments with a deadline, built for QIE mainnet. Patungan is a QUSDC escrow. An organizer opens a pool (seats × price, a
deadline, and a payee given as a `.qie` name or an address), and members join paying QUSDC, or QIE that the contract swaps to
QUSDC through QIEDEX in the same transaction. The last seat pays the payee in the same transaction. If the deadline passes
first, or the organizer cancels, every member can take their QUSDC back.

> **Status: mainnet deployment pending.** The contract (`src/Patungan.sol`) and the web app are built and tested on mocks and
> on a local fork of QIE mainnet (real QUSDC, QIEDEX, Zone `.qie` names and QIE Oracle state). No Patungan contract is on
> mainnet yet, so there are no mainnet transaction hashes here. Evidence: [`evidence/core-flow.md`](evidence/core-flow.md).

## Layout

- `src/Patungan.sol`: the escrow (one contract holds every pool). `src/interfaces/`: the QIE component interfaces (QIEDEX
  router, Zone `.qie` names, QIE Oracle).
- `test/`: unit tests on mocks (`Patungan.t.sol`), fuzz, invariants, `fork/` (Patungan against live QIE mainnet state),
  `spike/` (the day-one fork spike with a test-only escrow), `mocks/`, `utils/` (QIE mainnet addresses, fork helper).
- `script/`: `deploy-mainnet.sh` (preflight, deploy, Blockscout verify), `seed-demo.py` (builder demo pools), `local-flow.sh`
  (deploy + seed on an anvil fork), `bench.py` (gas and swap cost from receipts), `mutation-check.sh`, `e2e-local.py` and
  `e2e-create.py` (browser click-throughs), `export-abi.sh`, `fork-gas.sh`, `mainnet-probe.sh` (read-only mainnet checks).
- `web/`: the app (Vite + TypeScript + viem): pool page with join (QIE or QUSDC), refunds and cancel, `/new` to create a pool,
  `/verify` for the contract and its QIE components.
- `.github/workflows/ci.yml`: forge fmt + build + all tests (unit, fuzz, invariants, mainnet fork), and the web tests + build.
- `evidence/`: raw run outputs (tests, mutation check, gas, bench, browser runs) and the summaries that cite them.

## Run

```sh
git submodule update --init --recursive
forge test -vv                    # forks QIE mainnet through the public RPC (override with QIE_RPC_URL)
cd web && npm ci && npm test && npm run build
```

## Dependencies

OpenZeppelin Contracts v5.7.0, forge-std v1.17.0, viem 2.x, Vite 8, TypeScript 5. These are standard libraries used as dependencies, not forked code.

## License

MIT, see [LICENSE](LICENSE).
