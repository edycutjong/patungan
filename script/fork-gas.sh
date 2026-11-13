#!/usr/bin/env bash
# Measures real transaction gasUsed for the spike escrow on an anvil fork of QIE mainnet.
# No keys: anvil impersonates throwaway addresses (--unlocked). Nothing is sent to mainnet.
#   anvil --fork-url https://rpc1mainnet.qie.digital/ --chain-id 1990 --port 8547 &
#   script/fork-gas.sh http://127.0.0.1:8547
set -euo pipefail
RPC=${1:-http://127.0.0.1:8547}
QUSDC=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5
ROUTER=0x08cd2e72e156D8563B4351eb4065C262A9f553Ef
ZONE=0x9aab56e7727af53A3131985BFB16d845319b7bdc
ORACLE=0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17
WQIE=0x0087904D95BEe9E5F24dc8852804b547981A9139
ORG=0x00000000000000000000000000000000000a11CE
ALICE=0x00000000000000000000000000000000000B0b00
BOB=0x0000000000000000000000000000000000C0FFEE

[ "$(cast chain-id --rpc-url "$RPC")" = 1990 ] || { echo "not a chain-1990 fork" >&2; exit 1; }
# Refuse to run against anything but a local anvil node (a real mainnet RPC has no anvil_nodeInfo).
cast rpc --rpc-url "$RPC" anvil_nodeInfo >/dev/null 2>&1 || { echo "not an anvil fork; refusing" >&2; exit 1; }
for a in $ORG $ALICE $BOB; do
  cast rpc --rpc-url "$RPC" anvil_setBalance $a 0x56BC75E2D63100000 >/dev/null # 100 QIE
  cast rpc --rpc-url "$RPC" anvil_impersonateAccount $a >/dev/null
done
gas() { cast receipt --rpc-url "$RPC" "$1" gasUsed; }
send() { cast send --rpc-url "$RPC" --unlocked --json "$@" | python3 -c 'import sys,json;print(json.load(sys.stdin)["transactionHash"])'; }

echo "fork block $(cast block-number --rpc-url "$RPC")"
BC=$(forge inspect test/spike/SpikeEscrow.sol:SpikeEscrow bytecode)
ARGS=$(cast abi-encode 'f(address,address,address,address,uint256,uint256)' $QUSDC $ROUTER $ZONE $ORACLE 1500 172800)
TX=$(send --from $ORG --create "${BC}${ARGS#0x}")
ESCROW=$(cast receipt --rpc-url "$RPC" "$TX" contractAddress)
echo "deploy SpikeEscrow gasUsed $(gas "$TX")"

DEADLINE=$(( $(cast block --rpc-url "$RPC" latest -f timestamp) + 86400 ))
TX=$(send --from $ORG $ESCROW 'createByName(string,uint96,uint16,uint40)' test 250000 2 $DEADLINE)
echo "createByName (.qie resolve) gasUsed $(gas "$TX")"

PATH_ARG="[$WQIE,$QUSDC]"
send --from $ALICE --value 10ether $ROUTER 'swapETHForExactTokens(uint256,address[],address,uint256)' 250000 "$PATH_ARG" $ALICE $DEADLINE >/dev/null
send --from $ALICE $QUSDC 'approve(address,uint256)' $ESCROW 250000 >/dev/null
TX=$(send --from $ALICE $ESCROW 'join(uint256)' 1)
echo "join with QUSDC, seat 1 of 2 gasUsed $(gas "$TX")"

QUOTE=$(cast call --rpc-url "$RPC" $ROUTER 'getAmountsIn(uint256,address[])(uint256[])' 250000 "$PATH_ARG" | tr -d '[]' | cut -d' ' -f1)
VALUE=$(python3 -c "print($QUOTE*101//100)")
TX=$(send --from $BOB --value $VALUE $ESCROW 'joinWithQIE(uint256)' 1)
echo "joinWithQIE, last seat (swap + forward + payout) gasUsed $(gas "$TX")"
