// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {QieMainnet} from "../utils/QieMainnet.sol";
import {IQieDexRouter} from "../../src/interfaces/IQieDexRouter.sol";
import {IQieZone} from "../../src/interfaces/IQieZone.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {SpikeEscrow} from "./SpikeEscrow.sol";

interface IV2Factory {
    function getPair(address a, address b) external view returns (address);
}

interface IV2Pair {
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
}

/// @notice Day-one spike on a fork of QIE mainnet: QUSDC, QIEDEX, Zone and the QIE Oracle, all real state.
/// Run: forge test --match-path 'test/spike/*' -vv   (QIE_RPC_URL optional; defaults to rpc1mainnet)
contract SpikeForkTest is QieMainnet {
    IERC20 qusdc = IERC20(QUSDC);
    IQieDexRouter router = IQieDexRouter(ROUTER);
    IQieZone zone = IQieZone(ZONE);
    IAggregatorV3 oracle = IAggregatorV3(ORACLE_QIE_USD);

    SpikeEscrow escrow;
    uint96 constant PRICE = 250_000; // 0.25 QUSDC, the demo-pool seat price (6 decimals)
    uint256 constant MAX_DEV_BPS = 1_500; // deploy default
    uint256 constant MAX_ORACLE_AGE = 172_800; // 48 h

    // A real, existing `.qie` name read on mainnet (P0c). Used as a READ demo only; on the fork, never on mainnet.
    string constant NAME = "test";
    address constant NAME_OWNER = 0x2220541bC5506E01be95bdc82297Fbf061df132A;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        _forkQie();
        escrow = new SpikeEscrow(qusdc, router, zone, oracle, MAX_DEV_BPS, MAX_ORACLE_AGE);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        console2.log("fork block", block.number, "timestamp", block.timestamp);
    }

    // ---------------------------------------------------------------- component 1: QIE Oracle
    function test_oracle_latestRoundData_isLiveAndFresh() public view {
        assertEq(oracle.decimals(), 8);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        assertGt(roundId, 0);
        assertGt(answer, 0, "QIE/USD answer must be positive");
        uint256 age = block.timestamp - updatedAt;
        console2.log("oracle QIE/USD (8 dp)", uint256(answer), "age s", age);
        assertLe(age, MAX_ORACLE_AGE, "oracle older than maxOracleAge: QIE path would revert OracleStale");
    }

    function test_oracle_latestAnswer_reverts_soWeNeverUseIt() public {
        (bool ok,) = ORACLE_QIE_USD.call(abi.encodeWithSignature("latestAnswer()"));
        assertFalse(ok);
    }

    // ---------------------------------------------------------------- component 2: Zone .qie names
    function test_zone_resolvesRealName() public view {
        assertTrue(zone.domainExistsByName(NAME, "qie"));
        assertEq(zone.domainOwnerByName(NAME, "qie"), NAME_OWNER);
    }

    function test_zone_inputFormat_lowercaseLabelOnly() public view {
        assertFalse(zone.domainExistsByName("TEST", "qie"));
        assertFalse(zone.domainExistsByName("test.qie", "qie"));
        assertFalse(zone.domainExistsByName(NAME, ".qie"));
    }

    function test_zone_unknownName_reverts() public {
        vm.expectRevert();
        zone.domainOwnerByName("patungan-spike-no-such-name-7f3a", "qie");
    }

    // ---------------------------------------------------------------- component 3: QIEDEX router + pair
    function test_router_pairIsTheLiveWqieQusdcPool() public view {
        assertEq(router.WETH(), WQIE);
        assertEq(router.factory(), FACTORY);
        assertEq(IV2Factory(FACTORY).getPair(WQIE, QUSDC), PAIR_WQIE_QUSDC);
        (uint112 r0, uint112 r1,) = IV2Pair(PAIR_WQIE_QUSDC).getReserves();
        assertGt(r0, 0);
        assertGt(r1, 0);
        console2.log("pair reserves", uint256(r0), uint256(r1));
    }

    function test_router_swapExactOut_fromEOA() public {
        uint256 quoted = router.getAmountsIn(PRICE, _path())[0];
        uint256 qieBefore = alice.balance;
        vm.prank(alice);
        uint256[] memory amounts = router.swapETHForExactTokens{value: 10 ether}(PRICE, _path(), alice, block.timestamp);
        assertEq(amounts[0], quoted, "spent == getAmountsIn quote");
        assertEq(amounts[1], PRICE);
        assertEq(qusdc.balanceOf(alice), PRICE);
        assertEq(qieBefore - alice.balance, quoted, "router refunded the unspent QIE");
        console2.log("QIE in for 0.25 QUSDC", quoted);
    }

    // ---------------------------------------------------------------- component 4: QUSDC escrow
    function test_qusdc_isSixDecimals() public view {
        assertEq(IERC20Metadata(QUSDC).decimals(), 6);
    }

    /// QUSDC acquired the real way (QIEDEX swap), then approve + transferFrom into escrow; the last seat pays the
    /// payee resolved from a real `.qie` name, in the same tx.
    function test_escrow_qusdcJoins_lastSeatPaysPayee() public {
        uint256 id = escrow.createByName(NAME, PRICE, 2, uint40(block.timestamp + 1 days));
        _buyQusdcAndJoin(alice, id);
        assertEq(qusdc.balanceOf(address(escrow)), PRICE, "escrow holds seat 1");

        uint256 payeeBefore = qusdc.balanceOf(NAME_OWNER);
        _buyQusdcAndJoin(bob, id);
        assertEq(qusdc.balanceOf(NAME_OWNER) - payeeBefore, 2 * PRICE, "payee got the full pot");
        assertEq(qusdc.balanceOf(address(escrow)), 0);
        (,,,, uint16 filled, bool paid) = escrow.pools(id);
        assertEq(filled, 2);
        assertTrue(paid);
    }

    /// G1 contract-origin path: the ESCROW is msg.sender to the router, receives the unspent QIE in receive(),
    /// forwards it to the member, and the last seat pays out, all in one tx.
    function test_escrow_joinWithQIE_contractOrigin_forwardsExcess_lastSeatPays() public {
        uint256 id = escrow.createByName(NAME, PRICE, 2, uint40(block.timestamp + 1 days));
        _buyQusdcAndJoin(alice, id);

        uint256 quoted = router.getAmountsIn(PRICE, _path())[0];
        uint256 sent = (quoted * 101) / 100; // the UI's 1% tolerance over the live quote
        uint256 bobBefore = bob.balance;
        uint256 payeeBefore = qusdc.balanceOf(NAME_OWNER);

        vm.prank(bob);
        uint256 g = gasleft();
        escrow.joinWithQIE{value: sent}(id);
        console2.log("joinWithQIE (last seat, swap + payout) gas", g - gasleft());

        assertEq(bobBefore - bob.balance, quoted, "member paid exactly the router's input; excess forwarded back");
        assertEq(address(escrow).balance, 0, "escrow keeps no QIE");
        assertEq(qusdc.balanceOf(NAME_OWNER) - payeeBefore, 2 * PRICE, "last seat paid the payee in the same tx");
        assertEq(escrow.paidBy(id, bob), PRICE);
    }

    function test_escrow_refundAfterDeadline() public {
        uint256 id = escrow.createByName(NAME, PRICE, 3, uint40(block.timestamp + 1 days));
        _buyQusdcAndJoin(alice, id);
        vm.prank(bob);
        escrow.joinWithQIE{value: 10 ether}(id);
        assertEq(qusdc.balanceOf(address(escrow)), 2 * PRICE);

        vm.prank(alice);
        vm.expectRevert(SpikeEscrow.NotRefundable.selector);
        escrow.refund(id); // too early

        vm.warp(block.timestamp + 1 days);
        vm.prank(carol);
        vm.expectRevert(SpikeEscrow.NotOpen.selector);
        escrow.joinWithQIE{value: 10 ether}(id); // past deadline: closed

        vm.prank(alice);
        escrow.refund(id);
        vm.prank(bob);
        escrow.refund(id);
        assertEq(qusdc.balanceOf(alice), PRICE);
        assertEq(qusdc.balanceOf(bob), PRICE, "QIE payer is refunded in QUSDC");
        assertEq(qusdc.balanceOf(address(escrow)), 0);

        vm.prank(alice);
        vm.expectRevert(SpikeEscrow.NotRefundable.selector);
        escrow.refund(id); // no double refund
    }

    function test_escrow_oracleStale_revertsQiePath() public {
        uint256 id = escrow.createByName(NAME, PRICE, 2, uint40(block.timestamp + 10 days));
        (,,, uint256 updatedAt,) = oracle.latestRoundData();
        vm.warp(updatedAt + MAX_ORACLE_AGE + 1);
        vm.prank(bob);
        vm.expectRevert(SpikeEscrow.OracleStale.selector);
        escrow.joinWithQIE{value: 10 ether}(id);
    }

    /// The guard really binds: if the Oracle says QIE is worth 2x what the live AMM pays, the router's input is
    /// far above oracle-fair + 15% and joinWithQIE reverts PriceDeviation before any swap.
    function test_escrow_priceDeviation_revertsBeforeSwap() public {
        uint256 id = escrow.createByName(NAME, PRICE, 2, uint40(block.timestamp + 1 days));
        (uint80 r, int256 answer, uint256 s, uint256 u, uint80 a) = oracle.latestRoundData();
        int256 doubled = answer * 2;
        vm.mockCall(
            ORACLE_QIE_USD,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(r, doubled, s, u, a)
        );
        uint256 fair = (uint256(PRICE) * 1e20 + uint256(doubled) - 1) / uint256(doubled);
        uint256 qieIn = router.getAmountsIn(PRICE, _path())[0];
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SpikeEscrow.PriceDeviation.selector, fair, qieIn));
        escrow.joinWithQIE{value: 10 ether}(id);
    }

    /// Today's live spread (no mocks) sits inside the 15% deploy-default guard.
    function test_escrow_liveSpread_insideDeployGuard() public view {
        (, int256 answer,,,) = oracle.latestRoundData();
        uint256 fair = (uint256(PRICE) * 1e20 + uint256(answer) - 1) / uint256(answer);
        uint256 qieIn = router.getAmountsIn(PRICE, _path())[0];
        console2.log("oracle-fair QIE", fair, "router QIE in", qieIn);
        console2.log("router premium over oracle, bps", qieIn > fair ? ((qieIn - fair) * 10_000) / fair : 0);
        assertLe(qieIn * 10_000, fair * (10_000 + MAX_DEV_BPS));
    }

    function test_escrow_receive_rejectsNonRouter() public {
        vm.prank(alice);
        (bool ok,) = address(escrow).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_escrow_createByName_unknownName_reverts() public {
        vm.expectRevert();
        escrow.createByName("patungan-spike-no-such-name-7f3a", PRICE, 2, uint40(block.timestamp + 1 days));
    }

    // ---------------------------------------------------------------- helpers
    function _buyQusdcAndJoin(address who, uint256 id) internal {
        vm.startPrank(who);
        router.swapETHForExactTokens{value: 10 ether}(PRICE, _path(), who, block.timestamp);
        qusdc.approve(address(escrow), PRICE);
        escrow.join(id);
        vm.stopPrank();
    }
}
