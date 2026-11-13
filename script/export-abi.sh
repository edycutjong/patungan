#!/usr/bin/env bash
# Regenerate web/src/patungan-abi.ts from the compiled contract.
set -euo pipefail
cd "$(dirname "$0")/.."
ABI=$(forge inspect src/Patungan.sol:Patungan abi --json)
{
  echo "// Generated from the Foundry build by script/export-abi.sh (forge inspect Patungan abi). Do not edit."
  printf 'export const patunganAbi = %s as const\n' "$ABI"
} > web/src/patungan-abi.ts
