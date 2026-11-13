#!/usr/bin/env bash
# Deploy Patungan, verify its source on Blockscout, and add it to the web manifest.
#
#   set -a; . ~/.config/patungan/mainnet-deployer.env; set +a      # DEPLOYER_PRIVATE_KEY (never echoed here)
#   script/deploy-mainnet.sh                                      # QIE mainnet, chain 1990, rpc1 → rpc5 failover
#   RPC=http://127.0.0.1:8547 VERIFY=0 MANIFEST=/tmp/d.json script/deploy-mainnet.sh   # rehearsal on an anvil fork
#
# NOTE: foundry's cast only takes the key as --private-key (ETH_PRIVATE_KEY is not read), so it is briefly visible in `ps` on this
# machine. Accepted for a single-user laptop; use a foundry keystore if that ever changes.
#
# Spends real QIE on mainnet (~3M gas, a fraction of a QIE). Preflight (G1b) must pass first: the router quotes, the pair has reserves,
# the Oracle is fresh. Constructor: maxDevBps 1500 (the deploy default), maxOracleAge 172800 s. Writes deployments.json only after
# the contract's code is on chain and (unless VERIFY=0) Blockscout says the source is verified.
set -euo pipefail
cd "$(dirname "$0")/.."
QUSDC=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5
ROUTER=0x08cd2e72e156D8563B4351eb4065C262A9f553Ef
ZONE=0x9aab56e7727af53A3131985BFB16d845319b7bdc
ORACLE=0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17
WQIE=0x0087904D95BEe9E5F24dc8852804b547981A9139
MAX_DEV_BPS=${MAX_DEV_BPS:-1500}
MAX_ORACLE_AGE=${MAX_ORACLE_AGE:-172800}
VERIFY=${VERIFY:-1}
MANIFEST=${MANIFEST:-web/public/deployments.json}
EXPLORER=https://mainnet.qie.digital
DEP_ID=${DEP_ID:-mainnet-1}
OVERWRITE=${OVERWRITE:-0}
: "${DEPLOYER_PRIVATE_KEY:?load ~/.config/patungan/mainnet-deployer.env first}"
# A second deploy under the same id would drop the first from the manifest (its pools would vanish from the UI).
if [ -f "$MANIFEST" ] && [ "$OVERWRITE" != 1 ] && python3 -c "import json,sys; sys.exit(0 if any(d['id']=='$DEP_ID' for d in json.load(open('$MANIFEST'))['deployments']) else 1)"; then
  echo "$MANIFEST already has a deployment '$DEP_ID'. Use DEP_ID=mainnet-2 (old pools keep working) or OVERWRITE=1." >&2; exit 1
fi
# Real money: on the public RPCs (no RPC override) require an explicit CONFIRM=1.
if [ -z "${RPC:-}" ] && [ "${CONFIRM:-0}" != 1 ]; then
  echo "This deploys to QIE MAINNET and spends real QIE. Re-run with CONFIRM=1 once specs/mainnet-authorized exists." >&2; exit 1
fi

pick_rpc() {
  if [ -n "${RPC:-}" ]; then echo "$RPC"; return; fi
  for n in 1 2 3 4 5; do
    u=https://rpc${n}mainnet.qie.digital/
    [ "$(cast chain-id --rpc-url "$u" 2>/dev/null || true)" = 1990 ] && { echo "$u"; return; }
  done
  echo "no QIE RPC answered" >&2; exit 1
}
RPC=$(pick_rpc)
[ "$(cast chain-id --rpc-url "$RPC")" = 1990 ] || { echo "not chain 1990" >&2; exit 1; }
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
BAL=$(cast balance --rpc-url "$RPC" "$DEPLOYER" --ether)
echo "rpc $RPC · deployer $DEPLOYER · balance $BAL QIE"
python3 -c "import sys; sys.exit(0 if float('$BAL') >= 1.0 else 1)" || { echo "deployer needs >= 1 QIE for gas" >&2; exit 1; }

echo "== preflight (G1b)"
QUOTE=$(cast call --rpc-url "$RPC" $ROUTER 'getAmountsIn(uint256,address[])(uint256[])' 250000 "[$WQIE,$QUSDC]")
echo "router quote for 0.25 QUSDC: $QUOTE"
ROUND=$(cast call --rpc-url "$RPC" $ORACLE 'latestRoundData()(uint80,int256,uint256,uint256,uint80)')
UPDATED=$(echo "$ROUND" | sed -n 4p | awk '{print $1}')
NOW=$(cast block --rpc-url "$RPC" latest -f timestamp)
AGE=$((NOW - UPDATED))
echo "oracle age ${AGE}s (max ${MAX_ORACLE_AGE}s)"
[ "$AGE" -le "$MAX_ORACLE_AGE" ] || { echo "oracle is stale: a QIE join would revert; wait for an update" >&2; exit 1; }

echo "== build + deploy"
forge build >/dev/null
BC=$(forge inspect src/Patungan.sol:Patungan bytecode)
ARGS=$(cast abi-encode 'f(address,address,address,address,uint256,uint256)' $QUSDC $ROUTER $ZONE $ORACLE "$MAX_DEV_BPS" "$MAX_ORACLE_AGE")
OUT=$(cast send --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json --create "${BC}${ARGS#0x}")
TX=$(echo "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["transactionHash"])')
ADDR=$(cast receipt --rpc-url "$RPC" "$TX" contractAddress)
BLOCK=$(cast receipt --rpc-url "$RPC" "$TX" blockNumber)
GAS=$(cast receipt --rpc-url "$RPC" "$TX" gasUsed)
[ "$(cast code --rpc-url "$RPC" "$ADDR" | wc -c)" -gt 100 ] || { echo "no code at $ADDR" >&2; exit 1; }
echo "Patungan $ADDR · block $BLOCK · gas $GAS · tx $TX"
echo "reads: maxDevBps $(cast call --rpc-url "$RPC" "$ADDR" 'maxDevBps()(uint256)') · isSolvent $(cast call --rpc-url "$RPC" "$ADDR" 'isSolvent()(bool)')"

if [ "$VERIFY" = 1 ]; then
  echo "== verify on Blockscout"
  forge verify-contract "$ADDR" src/Patungan.sol:Patungan --chain-id 1990 --verifier blockscout --verifier-url "$EXPLORER/api/" \
    --constructor-args "${ARGS#0x}" --compiler-version 0.8.28 --evm-version shanghai --num-of-optimizations 200 --watch
  OK=$(curl -s "$EXPLORER/api/v2/smart-contracts/$ADDR" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("is_verified"))')
  [ "$OK" = True ] || { echo "Blockscout does not show the source as verified (is_verified=$OK)" >&2; exit 1; }
  echo "verified: $EXPLORER/address/$ADDR#code"
fi

python3 - "$MANIFEST" "$DEP_ID" "$ADDR" "$BLOCK" "$DEPLOYER" "$TX" <<'EOF'
import json, os, sys
path, dep_id, addr, block, deployer, tx = sys.argv[1:]
doc = json.load(open(path)) if os.path.exists(path) else {"deployments": []}
doc["deployments"] = [d for d in doc["deployments"] if d["id"] != dep_id] + [{
    "id": dep_id, "label": "QIE mainnet", "address": addr, "deployBlock": int(block), "chainId": 1990,
    "deployTx": tx, "builderWallets": [deployer],
}]
json.dump(doc, open(path, "w"), indent=2)
print("manifest updated:", path)
EOF
echo "next: redeploy the web app (cd web && vercel deploy --prod), add the tx to evidence/ and specs/mainnet-spend.md"
