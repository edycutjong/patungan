# Security policy

Patungan holds member funds (QUSDC) in escrow on QIE mainnet, so reports are taken seriously.

## Reporting a vulnerability
Please use GitHub's private vulnerability reporting (Security tab → "Report a vulnerability") rather than a public issue.
Include the pool id or transaction hash, steps to reproduce, and the impact you expect. We aim to acknowledge within 72 hours.

## Scope
- `src/Patungan.sol` and the deployed contract on QIE mainnet (chain 1990)
- The static web app in `web/`

## Design notes relevant to reporters
- No admin key in Patungan: no owner, no pause, no upgrade path. Pool funds can only go to the payee (when full) or back to members (refund).
- Residual risk we do not control: the QUSDC token's own privileged roles and the QIEDEX router. See `docs/security.md`.

## Tooling
CI runs forge tests (unit, fuzz, invariants, mainnet fork), Slither, gitleaks, CodeQL and `npm audit`. Findings and their triage: `docs/security.md`.
