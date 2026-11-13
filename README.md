# Patungan

Group payments with a deadline, on QIE mainnet. Patungan is being built as a QUSDC escrow. An organizer opens a pool (seats ×
price), and members join paying QUSDC, or QIE that the contract swaps to QUSDC through QIEDEX. The last seat pays the seller in the
same transaction. If the deadline passes first, every member can take their money back.

> **Status: work in progress.** The product contract (`src/Patungan.sol`) is not written yet. The day-one spike proves this
> flow on a fork of QIE mainnet with a test-only escrow: [`evidence/fork-spike.md`](evidence/fork-spike.md).

## Layout

- `src/interfaces/`: the QIE component interfaces (QIEDEX router, Zone `.qie` names, QIE Oracle). The product contract goes in `src/`.
- `test/utils/`: QIE mainnet addresses and the fork helper.
- `test/spike/`: fork tests against real QIE mainnet state, plus the test-only spike escrow.
- `script/`: `fork-gas.sh` (transaction gas on an anvil fork) and `mainnet-probe.sh` (read-only mainnet checks).
- `web/`: frontend scaffold (Vite + TypeScript + viem). For now it is a read-only status page for the QIE components.
- `.github/workflows/ci.yml`: CI runs forge fmt + build + the fork tests, and the web tests + build.
- `evidence/`: the spike's raw run outputs and the summary that cites them.

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
