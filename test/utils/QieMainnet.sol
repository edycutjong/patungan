// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

/// @notice QIE mainnet (chain 1990) addresses and a fork helper shared by every fork test.
/// Sources: QIEDEX docs + Blockscout (mainnet.qie.digital) verified contracts.
abstract contract QieMainnet is Test {
    uint256 internal constant QIE_CHAIN_ID = 1990;
    address internal constant QUSDC = 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5;
    address internal constant ROUTER = 0x08cd2e72e156D8563B4351eb4065C262A9f553Ef;
    address internal constant FACTORY = 0x8E23128a5511223bE6c0d64106e2D4508C08398C;
    address internal constant WQIE = 0x0087904D95BEe9E5F24dc8852804b547981A9139;
    address internal constant PAIR_WQIE_QUSDC = 0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe;
    address internal constant ZONE = 0x9aab56e7727af53A3131985BFB16d845319b7bdc;
    address internal constant ORACLE_QIE_USD = 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17;

    string internal constant DEFAULT_RPC = "https://rpc1mainnet.qie.digital/";

    /// @dev Forks QIE mainnet at the latest block: these tests check the contract against today's live QUSDC, QIEDEX,
    /// Zone and Oracle state, so a failure can mean the live state moved (a spread past the guard, a stale Oracle) as
    /// well as a regression. QIE_FORK_BLOCK pins a block to tell the two apart (needs an RPC that serves that state).
    /// QIE_RPC_URL overrides the default public RPC (rpc1..rpc5mainnet.qie.digital are interchangeable).
    function _forkQie() internal {
        string memory url = vm.envOr("QIE_RPC_URL", DEFAULT_RPC);
        uint256 pin = vm.envOr("QIE_FORK_BLOCK", uint256(0));
        if (pin == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, pin);
        assertEq(block.chainid, QIE_CHAIN_ID, "not QIE mainnet");
    }

    function _path() internal pure returns (address[] memory path) {
        path = new address[](2);
        (path[0], path[1]) = (WQIE, QUSDC);
    }
}
