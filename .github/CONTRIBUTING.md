# Contributing to Patungan

Thanks for helping. Patungan holds member funds in escrow on QIE mainnet, so changes to `src/` get extra scrutiny.

## Getting Started
```sh
git clone --recurse-submodules https://github.com/edycutjong/patungan.git
cd patungan
forge test -vv                         # unit, fuzz, invariants + QIE mainnet fork (public RPC)
cd web && npm ci && npm test && npm run build
```

## Before You Open a PR
- `forge fmt --check` and `forge test` pass; `forge coverage` keeps `src/` at 100%.
- In `web/`: `npm run typecheck`, `npm run test:coverage` (100% thresholds), `npm run build`, `npm run e2e`.
- Name new tests after the behaviour or defect they pin (`test_joinWithQIE_routerDrainsMoreNativeThanCeiling_revertsPriceDeviation`).
- Commit messages follow Angular conventions (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`); `release.yml` derives the
  semantic version from them.
- The deployed contract is source-verified on Blockscout. A change to `src/Patungan.sol` means a new deployment, not an
  edit of the live one; say so in the PR. The `lib/` submodules stay pinned to the verified build.

## Reporting Bugs / Requesting Features
Use the issue templates. Security issues go through private vulnerability reporting, see [SECURITY.md](../SECURITY.md).
