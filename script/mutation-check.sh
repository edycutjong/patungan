#!/usr/bin/env bash
# Inject deliberate bugs into src/Patungan.sol one at a time and check that the local test suite catches each one.
# The original file is restored after every mutation (and on exit). Usage: script/mutation-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=src/Patungan.sol
BAK=$(mktemp)
cp "$SRC" "$BAK"
trap 'cp "$BAK" "$SRC"; rm -f "$BAK"' EXIT

# name | perl substitution (applied once) | what the bug would do
MUTATIONS=(
  "refund-not-zeroed|s/paid\[id\]\[m\] = 0;/paid[id][m] = paid[id][m];/|a refunded member could claim again (double refund)"
  "no-last-seat-payout|s/if \(p\.filled == p\.seats\) \{/if (p.filled > p.seats) {/|the last seat would never pay the payee"
  "guard-off-by-2x|s/if \(qieIn > ceiling\) revert/if (qieIn > ceiling * 2) revert/|the Oracle guard would let QIEDEX charge up to twice the bound"
  "payout-keeps-totalHeld|s/totalHeld -= total;/totalHeld -= 0;/|a paid pool would still count as escrowed (accounting drift)"
)

caught=0
for row in "${MUTATIONS[@]}"; do
  IFS='|' read -r name sub why <<<"$row"
  cp "$BAK" "$SRC"
  perl -0pi -e "$sub" "$SRC"
  if cmp -s "$BAK" "$SRC"; then echo "MUTATION NOT APPLIED: $name"; exit 2; fi
  if forge test --no-match-path 'test/{fork,spike}/*' >/tmp/patungan-mutation-$name.log 2>&1; then
    echo "SURVIVED  $name  ($why)"
  else
    n=$(grep -c '^\[FAIL' /tmp/patungan-mutation-$name.log || true)
    echo "CAUGHT    $name  -> $n failing tests  ($why)"
    caught=$((caught + 1))
  fi
done
cp "$BAK" "$SRC"
echo "caught $caught of ${#MUTATIONS[@]} mutations"
[ "$caught" -eq "${#MUTATIONS[@]}" ]
