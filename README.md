# Patungan

Group payments with a deadline, on QIE mainnet. An organizer opens a pool (seats × price in QUSDC), and members join paying
QUSDC, or QIE that the contract swaps to QUSDC through QIEDEX. The last seat pays the seller in the same transaction. If the
deadline passes first, every member can take their money back.

> Work in progress. Day-one spike results: [`evidence/fork-spike.md`](evidence/fork-spike.md).

## Layout

- `src/`: Solidity contracts (Foundry). `src/interfaces/` holds the QIE component interfaces (QIEDEX router, Zone `.qie` names, QIE Oracle).
- `test/`: Foundry tests. `test/spike/` runs fork tests against real QIE mainnet state.
- `web/`: the static frontend (Vite + TypeScript + viem).
- `evidence/`: measured runs that back every number in this repo.

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
