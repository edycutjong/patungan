#!/usr/bin/env bash
# Read-only checks against QIE mainnet: no transaction is broadcast, no key is used.
# 1) which post-London opcodes chain 1990 accepts (why foundry.toml targets evm_version = shanghai);
# 2) the spike escrow's creation code runs on mainnet via eth_call / eth_estimateGas.
#   script/mainnet-probe.sh [rpc]
set -uo pipefail
RPC=${1:-https://rpc1mainnet.qie.digital/}
FROM=0x616F4e1d85D41F34330D3D0D167717c4015E69D7 # the project deployer address (used only as `from` in calls)

echo "chain $(cast chain-id --rpc-url "$RPC") block $(cast block-number --rpc-url "$RPC")"
probe() { # $1 label, $2 creation code that returns the 1-byte value 0x2a if the opcode ran
  out=$(cast rpc --rpc-url "$RPC" eth_call "{\"from\":\"$FROM\",\"data\":\"$2\"}" latest 2>&1)
  echo "$1: $out" | head -c 200; echo
}
probe "PUSH0  (0x5f, Shanghai)" 0x602a5f5360015ff3
probe "MCOPY  (0x5e, Cancun)  " 0x602a5f5360015f5f5e60015ff3
probe "TSTORE (0x5d, Cancun)  " 0x602a5f5d602a5f5360015ff3

BC=$(forge inspect test/spike/SpikeEscrow.sol:SpikeEscrow bytecode)
ARGS=$(cast abi-encode 'f(address,address,address,address,uint256,uint256)' \
  0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 0x08cd2e72e156D8563B4351eb4065C262A9f553Ef \
  0x9aab56e7727af53A3131985BFB16d845319b7bdc 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17 1500 172800)
DATA="${BC}${ARGS#0x}"
RUNTIME=$(cast rpc --rpc-url "$RPC" eth_call "{\"from\":\"$FROM\",\"data\":\"$DATA\"}" latest | tr -d '"')
echo "SpikeEscrow constructor via eth_call: returned $(( (${#RUNTIME} - 2) / 2 )) bytes of runtime code"
echo "SpikeEscrow deploy eth_estimateGas: $(cast estimate --rpc-url "$RPC" --from $FROM --create "$DATA")"
