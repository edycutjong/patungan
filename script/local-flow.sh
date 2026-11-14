#!/usr/bin/env bash
# Deploy Patungan on a LOCAL anvil fork of QIE mainnet, run the core flow with impersonated throwaway accounts, print
# each transaction's gasUsed and write web/public/deployments.local.json for the local frontend. No keys, nothing is
# sent to mainnet; refuses to run against anything that is not an anvil node.
#   anvil --fork-url https://rpc1mainnet.qie.digital/ --chain-id 1990 --port 8547 &
#   script/local-flow.sh http://127.0.0.1:8547
# Pools left behind for the UI: #1 PAID (QUSDC + QIE joins), #2 OPEN 2 of 4 (joinable), #3 CLOSED after its
# deadline (refundable, one member already claimed), #4 CANCELLED before any join.
set -euo pipefail
RPC=${1:-http://127.0.0.1:8547}
QUSDC=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5
ROUTER=0x08cd2e72e156D8563B4351eb4065C262A9f553Ef
ZONE=0x9aab56e7727af53A3131985BFB16d845319b7bdc
ORACLE=0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17
WQIE=0x0087904D95BEe9E5F24dc8852804b547981A9139
NAME=test # a real .qie name read on mainnet (P0c); fork only
ORG=0x00000000000000000000000000000000000a11CE
ALICE=0x00000000000000000000000000000000000B0b00
BOB=0x0000000000000000000000000000000000C0FFEE
CAROL=0x000000000000000000000000000000000000CA01
SEAT=250000 # 0.25 QUSDC

[ "$(cast chain-id --rpc-url "$RPC")" = 1990 ] || { echo "not a chain-1990 fork" >&2; exit 1; }
cast rpc --rpc-url "$RPC" anvil_nodeInfo >/dev/null 2>&1 || { echo "not an anvil fork; refusing" >&2; exit 1; }
for a in $ORG $ALICE $BOB $CAROL; do
  cast rpc --rpc-url "$RPC" anvil_setBalance $a 0x56BC75E2D63100000 >/dev/null # 100 QIE
  cast rpc --rpc-url "$RPC" anvil_impersonateAccount $a >/dev/null
done
send() { cast send --rpc-url "$RPC" --unlocked --json "$@" | python3 -c 'import sys,json;print(json.load(sys.stdin)["transactionHash"])'; }
gas() { printf '%-44s gasUsed %s\n' "$1" "$(cast receipt --rpc-url "$RPC" "$2" gasUsed)"; }
now() { cast block --rpc-url "$RPC" latest -f timestamp; }
PATH_ARG="[$WQIE,$QUSDC]"
buy() { send --from "$1" --value 50ether $ROUTER 'swapETHForExactTokens(uint256,address[],address,uint256)' "$2" "$PATH_ARG" "$1" $(( $(now) + 600 )) >/dev/null; }
qiejoin() { # who id n -> tx hash; sends the router quote + 1%, like the UI
  local q; q=$(cast call --rpc-url "$RPC" $PAT 'quoteQIE(uint256,uint16)(uint256,uint256,uint256)' "$2" "$3" | head -1 | awk '{print $1}')
  send --from "$1" --value "$(python3 -c "print($q * 101 // 100)")" $PAT 'joinWithQIE(uint256,uint16,uint40)' "$2" "$3" $(( $(now) + 300 ))
}

BLOCK=$(cast block-number --rpc-url "$RPC")
echo "fork block $BLOCK"
BC=$(forge inspect src/Patungan.sol:Patungan bytecode)
ARGS=$(cast abi-encode 'f(address,address,address,address,uint256,uint256)' $QUSDC $ROUTER $ZONE $ORACLE 1500 172800)
TX=$(send --from $ORG --create "${BC}${ARGS#0x}")
PAT=$(cast receipt --rpc-url "$RPC" "$TX" contractAddress)
DEPLOY_BLOCK=$(cast receipt --rpc-url "$RPC" "$TX" blockNumber)
gas "deploy Patungan" "$TX"
echo "Patungan at $PAT (block $DEPLOY_BLOCK)"
OWNER=$(cast call --rpc-url "$RPC" $ZONE 'domainOwnerByName(string,string)(address)' $NAME qie)
D=$(( $(now) + 86400 ))

# pool 1: PAID: QUSDC join, QIE join, QIE join fills the last seat and pays test.qie's owner
TX=$(send --from $ORG $PAT 'createPoolByName(string,address,uint96,uint16,uint40,string)' $NAME $OWNER $SEAT 3 $D "Thursday football")
gas "createPoolByName (.qie resolve + title)" "$TX"
buy $ALICE $SEAT
send --from $ALICE $QUSDC 'approve(address,uint256)' $PAT $SEAT >/dev/null
TX=$(send --from $ALICE $PAT 'join(uint256,uint16)' 1 1); gas "join (QUSDC, first seat)" "$TX"
TX=$(qiejoin $BOB 1 1); gas "joinWithQIE (middle seat)" "$TX"
P0=$(cast call --rpc-url "$RPC" $QUSDC 'balanceOf(address)(uint256)' $OWNER | awk '{print $1}')
TX=$(qiejoin $CAROL 1 1); gas "joinWithQIE (last seat -> payee paid)" "$TX"
P1=$(cast call --rpc-url "$RPC" $QUSDC 'balanceOf(address)(uint256)' $OWNER | awk '{print $1}')
echo "payee received $(( P1 - P0 )) QUSDC units in the last-seat tx (expect $(( SEAT * 3 )))"

# pool 2: OPEN 2 of 4, left joinable for the UI
TX=$(send --from $ORG $PAT 'createPool(address,uint96,uint16,uint40,string)' $OWNER $SEAT 4 $D "Arisan kue Bu Rina"); gas "createPool (address payee)" "$TX"
qiejoin $ALICE 2 1 >/dev/null
qiejoin $BOB 2 1 >/dev/null

# pool 3: will miss its deadline (11 min): QUSDC + QIE joins, then one claim and a batch refund
TX=$(send --from $ORG $PAT 'createPoolByName(string,address,uint96,uint16,uint40,string)' $NAME $OWNER $SEAT 5 $(( $(now) + 660 )) "Sewa villa Puncak")
buy $BOB $(( SEAT * 2 ))
send --from $BOB $QUSDC 'approve(address,uint256)' $PAT $(( SEAT * 2 )) >/dev/null
send --from $BOB $PAT 'join(uint256,uint16)' 3 2 >/dev/null
qiejoin $CAROL 3 1 >/dev/null
qiejoin $ALICE 3 1 >/dev/null

# pool 4: cancelled before the first join
send --from $ORG $PAT 'createPool(address,uint96,uint16,uint40,string)' $OWNER $SEAT 2 $D "Patungan kado" >/dev/null
TX=$(send --from $ORG $PAT 'cancel(uint256)' 4); gas "cancel (before first join)" "$TX"

cast rpc --rpc-url "$RPC" evm_increaseTime 700 >/dev/null
cast rpc --rpc-url "$RPC" evm_mine >/dev/null
TX=$(send --from $BOB $PAT 'claimRefund(uint256)' 3); gas "claimRefund (one member)" "$TX"
TX=$(send --from $ORG $PAT 'refundAll(uint256,uint256,uint256)' 3 0 25); gas "refundAll (2 members, 1 skipped)" "$TX"
echo "pool 3 refundedCount $(cast call --rpc-url "$RPC" $PAT 'refundedCount(uint256)(uint256)' 3)"
echo "escrow QUSDC $(cast call --rpc-url "$RPC" $QUSDC 'balanceOf(address)(uint256)' $PAT | awk '{print $1}') = totalHeld $(cast call --rpc-url "$RPC" $PAT 'totalHeld()(uint256)' | awk '{print $1}') (pool 2's two seats)"
echo "native QIE left in contract: $(cast balance --rpc-url "$RPC" $PAT)"

mkdir -p web/public
cat > web/public/deployments.local.json <<JSON
{ "deployments": [ { "id": "local", "label": "anvil fork of QIE mainnet (local only)", "address": "$PAT", "deployBlock": $DEPLOY_BLOCK, "chainId": 1990, "rpc": "$RPC" } ] }
JSON
echo "wrote web/public/deployments.local.json"
