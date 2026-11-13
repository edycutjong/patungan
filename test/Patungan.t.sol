// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Patungan} from "../src/Patungan.sol";
import {IQieDexRouter} from "../src/interfaces/IQieDexRouter.sol";
import {IQieZone} from "../src/interfaces/IQieZone.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {PatunganBase} from "./utils/PatunganBase.sol";
import {MockFeeToken, RejectingMember, ReenteringMember} from "./mocks/Mocks.sol";

/// @notice Unit tests on mocks: every acceptance item of the core flow, in spec order (F1..F7).
contract PatunganTest is PatunganBase {
    event PoolCreated(
        uint256 indexed id,
        address indexed organizer,
        address indexed payee,
        string payeeName,
        uint96 price,
        uint16 seats,
        uint40 deadline,
        string title
    );
    event Joined(
        uint256 indexed id,
        address indexed member,
        uint16 n,
        uint256 amount,
        bool paidWithQIE,
        uint256 qieSpent,
        uint256 oraclePrice
    );
    event PoolPaid(uint256 indexed id, address indexed payee, uint256 total);
    event PoolCancelled(uint256 indexed id);
    event Refunded(uint256 indexed id, address indexed member, uint256 amount);
    event RefundFailed(uint256 indexed id, address indexed member, uint256 amount);

    // ================================================================ constructor
    function test_constructor_readsDecimalsAndWqie() public view {
        assertEq(pat.oracleDecimals(), 8);
        assertEq(pat.qusdcDecimals(), 6);
        assertEq(pat.wqie(), wqie);
        assertEq(pat.maxDevBps(), DEV_BPS);
        assertEq(pat.maxOracleAge(), ORACLE_AGE);
    }

    function test_constructor_rejectsUnboundedGuard() public {
        IQieDexRouter r = IQieDexRouter(address(router));
        IQieZone z = IQieZone(address(zone));
        IAggregatorV3 o = IAggregatorV3(address(oracle));
        IERC20 q = IERC20(address(qusdc));
        vm.expectRevert(Patungan.BadParams.selector);
        new Patungan(q, r, z, o, 0, ORACLE_AGE);
        vm.expectRevert(Patungan.BadParams.selector);
        new Patungan(q, r, z, o, 2_001, ORACLE_AGE);
        vm.expectRevert(Patungan.BadParams.selector);
        new Patungan(q, r, z, o, DEV_BPS, 0);
        new Patungan(q, r, z, o, 2_000, ORACLE_AGE); // the hard cap itself is allowed
    }

    // ================================================================ F1 create
    function test_createPool_storesEverything_andEmits() public {
        uint40 deadline = uint40(block.timestamp + 1 days);
        vm.expectEmit(address(pat));
        emit PoolCreated(1, organizer, payee, "", PRICE, 5, deadline, "Futsal Kamis");
        vm.prank(organizer);
        uint256 id = pat.createPool(payee, PRICE, 5, deadline, "Futsal Kamis");
        assertEq(id, 1);
        assertEq(pat.nextId(), 1);
        (Patungan.Pool memory p, string memory title, string memory payeeName, uint256 mc, uint256 rc, bool refundable) =
            pat.getPool(id);
        assertEq(p.organizer, organizer);
        assertEq(p.payee, payee);
        assertEq(p.price, PRICE);
        assertEq(p.deadline, deadline);
        assertEq(p.seats, 5);
        assertEq(p.filled, 0);
        assertEq(uint8(p.status), uint8(Patungan.Status.Open));
        assertEq(p.held, 0);
        assertEq(title, "Futsal Kamis");
        assertEq(payeeName, "");
        assertEq(mc, 0);
        assertEq(rc, 0);
        assertFalse(refundable);
    }

    function test_createPool_boundsAreInclusive() public {
        vm.startPrank(organizer);
        pat.createPool(payee, 1, 2, uint40(block.timestamp + 10 minutes), "");
        pat.createPool(payee, type(uint96).max, 100, uint40(block.timestamp + 90 days), _str(64));
        vm.stopPrank();
        assertEq(pat.nextId(), 2);
    }

    function test_createPool_rejectsBadParams() public {
        uint40 d = uint40(block.timestamp + 1 days);
        vm.startPrank(organizer);
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPool(payee, 0, 5, d, "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPool(payee, PRICE, 1, d, "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPool(payee, PRICE, 101, d, "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPool(payee, PRICE, 5, uint40(block.timestamp + 10 minutes - 1), "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPool(payee, PRICE, 5, uint40(block.timestamp - 1), "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPool(payee, PRICE, 5, uint40(block.timestamp + 90 days + 1), "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPool(payee, PRICE, 5, d, _str(65));
        vm.expectRevert(Patungan.PayeeInvalid.selector);
        pat.createPool(address(0), PRICE, 5, d, "t");
        vm.expectRevert(Patungan.PayeeInvalid.selector);
        pat.createPool(address(pat), PRICE, 5, d, "t");
        vm.stopPrank();
    }

    function test_createPoolByName_snapshotsOwner_andStoresName() public {
        uint40 d = uint40(block.timestamp + 1 days);
        vm.expectEmit(address(pat));
        emit PoolCreated(1, organizer, payee, "lapangan", PRICE, 3, d, "Futsal");
        vm.prank(organizer);
        uint256 id = pat.createPoolByName("lapangan", payee, PRICE, 3, d, "Futsal");
        (Patungan.Pool memory p,, string memory payeeName,,,) = pat.getPool(id);
        assertEq(p.payee, payee);
        assertEq(payeeName, "lapangan");

        // the name changes hands after create: the money still goes to the snapshotted owner
        zone.set("lapangan", carol);
        _join(alice, id, 1);
        _join(bob, id, 2);
        assertEq(qusdc.balanceOf(payee), 3 * uint256(PRICE));
        assertEq(qusdc.balanceOf(carol), 1_000e6);
    }

    function test_createPoolByName_unknownName_reverts() public {
        vm.expectRevert(Patungan.PayeeNotFound.selector);
        pat.createPoolByName("nobody", payee, PRICE, 3, uint40(block.timestamp + 1 days), "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPoolByName("", payee, PRICE, 3, uint40(block.timestamp + 1 days), "t");
        vm.expectRevert(Patungan.BadParams.selector);
        pat.createPoolByName(_str(65), payee, PRICE, 3, uint40(block.timestamp + 1 days), "t");
    }

    function test_createPoolByName_resolvedElsewhere_revertsPayeeChanged() public {
        zone.set("lapangan", carol); // the name moved between the form's read and the tx
        vm.expectRevert(abi.encodeWithSelector(Patungan.PayeeChanged.selector, carol));
        pat.createPoolByName("lapangan", payee, PRICE, 3, uint40(block.timestamp + 1 days), "t");
    }

    // ================================================================ F2 join with QUSDC
    function test_join_pullsQusdc_andRecordsSeat() public {
        uint256 id = _create(5);
        vm.expectEmit(address(pat));
        emit Joined(id, alice, 2, 2 * uint256(PRICE), false, 0, 0);
        _join(alice, id, 2);
        assertEq(qusdc.balanceOf(address(pat)), 2 * uint256(PRICE));
        assertEq(pat.paid(id, alice), 2 * uint256(PRICE));
        assertEq(pat.seatsOf(id, alice), 2);
        assertEq(pat.totalHeld(), 2 * uint256(PRICE));
        Patungan.Pool memory p = _pool(id);
        assertEq(p.filled, 2);
        assertEq(p.held, 2 * uint256(PRICE));
        // a second join by the same member adds seats, not a roster entry
        _join(alice, id, 1);
        (address[] memory a, uint16[] memory s, uint256[] memory o) = pat.getMembers(id, 0, 10);
        assertEq(a.length, 1);
        assertEq(a[0], alice);
        assertEq(s[0], 3);
        assertEq(o[0], 3 * uint256(PRICE));
    }

    function test_join_rejects() public {
        uint256 id = _create(3);
        vm.prank(alice);
        vm.expectRevert(Patungan.BadParams.selector);
        pat.join(id, 0);
        vm.prank(alice);
        vm.expectRevert(Patungan.TooManySeats.selector);
        pat.join(id, 4);
        vm.prank(alice);
        vm.expectRevert(Patungan.PoolNotOpen.selector);
        pat.join(99, 1);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(Patungan.PoolNotOpen.selector);
        pat.join(id, 1);
    }

    function test_join_feeOnTransferToken_revertsTransferShort() public {
        MockFeeToken fee = new MockFeeToken();
        Patungan p2 = _deploy(IERC20(address(fee)));
        fee.mint(alice, 10e6);
        vm.prank(organizer);
        uint256 id = p2.createPool(payee, PRICE, 2, uint40(block.timestamp + 1 days), "t");
        vm.startPrank(alice);
        fee.approve(address(p2), type(uint256).max);
        vm.expectRevert(Patungan.TransferShort.selector);
        p2.join(id, 1);
        vm.stopPrank();
    }

    // ================================================================ F4 last seat pays the payee
    function test_lastSeat_paysPayee_inSameTx() public {
        uint256 id = _create(3);
        _join(alice, id, 1);
        _join(bob, id, 1);
        vm.expectEmit(address(pat));
        emit Joined(id, carol, 1, PRICE, false, 0, 0);
        vm.expectEmit(address(pat));
        emit PoolPaid(id, payee, 3 * uint256(PRICE));
        _join(carol, id, 1);
        assertEq(qusdc.balanceOf(payee), 3 * uint256(PRICE));
        assertEq(qusdc.balanceOf(address(pat)), 0);
        assertEq(pat.totalHeld(), 0);
        Patungan.Pool memory p = _pool(id);
        assertEq(uint8(p.status), uint8(Patungan.Status.Paid));
        assertEq(p.held, 0);
        assertEq(p.filled, 3);
        // a paid pool takes no joins, no refunds, no cancel
        vm.prank(alice);
        vm.expectRevert(Patungan.PoolNotOpen.selector);
        pat.join(id, 1);
        vm.warp(block.timestamp + 2 days);
        assertFalse(pat.isRefundable(id));
        vm.prank(alice);
        vm.expectRevert(Patungan.NotRefundable.selector);
        pat.claimRefund(id);
        vm.expectRevert(Patungan.NotRefundable.selector);
        pat.refundAll(id, 0, 10);
    }

    function test_lastSeat_oneMemberTakesEverySeat() public {
        uint256 id = _create(4);
        _join(alice, id, 4);
        assertEq(qusdc.balanceOf(payee), 4 * uint256(PRICE));
    }

    function test_pools_areIsolated() public {
        uint256 a = _create(2);
        uint256 b = _create(2);
        _join(alice, a, 1);
        _join(bob, b, 1);
        _join(carol, a, 1); // fills A only
        assertEq(qusdc.balanceOf(payee), 2 * uint256(PRICE));
        assertEq(_pool(b).held, PRICE);
        assertEq(pat.totalHeld(), PRICE);
    }

    // ================================================================ F3 join with QIE
    function test_joinWithQIE_swapsExactOut_returnsChange() public {
        uint256 id = _create(5);
        (uint256 qieIn, uint256 fair, uint256 maxAllowed) = pat.quoteQIE(id, 2);
        assertEq(maxAllowed, fair * (10_000 + DEV_BPS) / 10_000);
        assertLe(qieIn, maxAllowed);
        uint256 value = qieIn * 101 / 100;
        uint256 before = alice.balance;
        vm.expectEmit(address(pat));
        emit Joined(id, alice, 2, 2 * uint256(PRICE), true, qieIn, uint256(ORACLE_PRICE));
        vm.prank(alice);
        pat.joinWithQIE{value: value}(id, 2, uint40(block.timestamp + 300));
        assertEq(before - alice.balance, qieIn, "member paid exactly the router quote; change came back");
        assertEq(address(pat).balance, 0, "no native QIE sticks");
        assertEq(pat.paid(id, alice), 2 * uint256(PRICE));
        assertEq(qusdc.balanceOf(address(pat)), 2 * uint256(PRICE));
    }

    function test_joinWithQIE_lastSeat_paysPayee() public {
        uint256 id = _create(2);
        _join(alice, id, 1);
        vm.expectEmit(address(pat));
        emit PoolPaid(id, payee, 2 * uint256(PRICE));
        _joinQIE(bob, id, 1);
        assertEq(qusdc.balanceOf(payee), 2 * uint256(PRICE));
        assertEq(address(pat).balance, 0);
    }

    function test_joinWithQIE_valueAboveCeiling_swapsAtMostCeiling() public {
        uint256 id = _create(5);
        (uint256 qieIn,,) = pat.quoteQIE(id, 1);
        uint256 before = alice.balance;
        vm.prank(alice);
        pat.joinWithQIE{value: 100 ether}(id, 1, uint40(block.timestamp));
        assertEq(before - alice.balance, qieIn);
        assertEq(address(pat).balance, 0);
    }

    function test_joinWithQIE_expired_reverts() public {
        uint256 id = _create(5);
        vm.prank(alice);
        vm.expectRevert(Patungan.QuoteExpired.selector);
        pat.joinWithQIE{value: 10 ether}(id, 1, uint40(block.timestamp - 1));
    }

    function test_joinWithQIE_valueTooLow_reverts() public {
        uint256 id = _create(5);
        (uint256 qieIn,,) = pat.quoteQIE(id, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Patungan.ValueTooLow.selector, qieIn, qieIn - 1));
        pat.joinWithQIE{value: qieIn - 1}(id, 1, uint40(block.timestamp));
    }

    function test_joinWithQIE_routerAboveOracleBound_revertsPriceDeviation() public {
        uint256 id = _create(5);
        (, uint256 fair,) = pat.quoteQIE(id, 1);
        router.setRate(ROUTER_RATE * 12 / 10); // ≈ 26.6% over the Oracle: past the 15% guard
        (uint256 qieIn,,) = pat.quoteQIE(id, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Patungan.PriceDeviation.selector, fair, qieIn));
        pat.joinWithQIE{value: 100 ether}(id, 1, uint40(block.timestamp));
    }

    function test_joinWithQIE_guardEdge_exactCeilingPasses_oneWeiOverFails() public {
        uint256 id = _create(5);
        (, uint256 fair, uint256 maxAllowed) = pat.quoteQIE(id, 1);
        // rate such that getAmountsIn(PRICE) == maxAllowed exactly: rate = maxAllowed * 1e6 / PRICE
        router.setRate(maxAllowed * 1e6 / PRICE);
        (uint256 qieIn,,) = pat.quoteQIE(id, 1);
        assertLe(qieIn, maxAllowed);
        vm.prank(alice);
        pat.joinWithQIE{value: maxAllowed}(id, 1, uint40(block.timestamp));
        router.setRate(maxAllowed * 1e6 / PRICE + 4);
        (qieIn,,) = pat.quoteQIE(id, 1);
        assertEq(qieIn, maxAllowed + 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Patungan.PriceDeviation.selector, fair, qieIn));
        pat.joinWithQIE{value: 100 ether}(id, 1, uint40(block.timestamp));
    }

    function test_joinWithQIE_routerOverchargingBeyondCeiling_cannotTakeMore() public {
        uint256 id = _create(5);
        router.setOverchargeBps(2_000); // the router tries to charge 20% over its own quote
        vm.prank(alice);
        vm.expectRevert(bytes("EXCESSIVE_INPUT_AMOUNT")); // the swap was given at most the Oracle ceiling
        pat.joinWithQIE{value: 100 ether}(id, 1, uint40(block.timestamp));
    }

    function test_joinWithQIE_swapDeliversShort_reverts() public {
        uint256 id = _create(5);
        router.setDeliverShortBy(1);
        vm.prank(alice);
        vm.expectRevert(Patungan.SwapShort.selector);
        pat.joinWithQIE{value: 10 ether}(id, 1, uint40(block.timestamp));
    }

    function test_joinWithQIE_oracleStale_reverts_qusdcPathStillWorks() public {
        uint256 id = _create(5);
        uint256 updated = block.timestamp - ORACLE_AGE - 1;
        oracle.set(ORACLE_PRICE, updated);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Patungan.OracleStale.selector, updated));
        pat.joinWithQIE{value: 10 ether}(id, 1, uint40(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(Patungan.OracleStale.selector, updated));
        pat.quoteQIE(id, 1);
        _join(alice, id, 1); // QUSDC path never reads the Oracle
        // exactly maxOracleAge old is still fresh
        oracle.set(ORACLE_PRICE, block.timestamp - ORACLE_AGE);
        _joinQIE(bob, id, 1);
    }

    function test_joinWithQIE_oracleBadPrice_reverts() public {
        uint256 id = _create(5);
        oracle.set(0, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(Patungan.OracleBadPrice.selector);
        pat.joinWithQIE{value: 10 ether}(id, 1, uint40(block.timestamp));
        oracle.set(-1, block.timestamp);
        vm.expectRevert(Patungan.OracleBadPrice.selector);
        pat.quoteQIE(id, 1);
    }

    function test_joinWithQIE_memberRejectsChange_revertsForwardFailed() public {
        uint256 id = _create(5);
        RejectingMember m = new RejectingMember();
        vm.deal(address(this), 10 ether);
        vm.expectRevert(Patungan.ForwardFailed.selector);
        m.joinWithQIE{value: 10 ether}(address(pat), id, 1, uint40(block.timestamp));
    }

    function test_joinWithQIE_reentryOnChange_isBlocked() public {
        uint256 id = _create(5);
        ReenteringMember m = new ReenteringMember();
        vm.deal(address(this), 10 ether);
        m.joinWithQIE{value: 10 ether}(address(pat), id, uint40(block.timestamp));
        assertFalse(m.reentered());
        assertEq(bytes4(m.lastError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(pat.seatsOf(id, address(m)), 1);
    }

    function test_receive_rejectsAnyoneButRouter() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(pat).call{value: 1}("");
        assertFalse(ok);
        assertEq(bytes4(ret), Patungan.OnlyRouter.selector);
    }

    function test_quoteQIE_unknownPool_reverts() public {
        vm.expectRevert(Patungan.BadParams.selector);
        pat.quoteQIE(42, 1);
    }

    // ================================================================ F5 refunds
    function test_claimRefund_afterDeadline_returnsQusdc_once() public {
        uint256 id = _create(5);
        _join(alice, id, 2);
        _joinQIE(bob, id, 1); // paid in QIE, refunded in QUSDC
        vm.prank(alice);
        vm.expectRevert(Patungan.NotRefundable.selector);
        pat.claimRefund(id);

        vm.warp(block.timestamp + 1 days); // deadline reached (>=)
        assertTrue(pat.isRefundable(id));
        vm.expectEmit(address(pat));
        emit Refunded(id, alice, 2 * uint256(PRICE));
        vm.prank(alice);
        pat.claimRefund(id);
        assertEq(qusdc.balanceOf(alice), 1_000e6);
        assertEq(pat.paid(id, alice), 0);
        assertEq(pat.refundedCount(id), 1);
        assertEq(_pool(id).held, PRICE);
        assertEq(pat.totalHeld(), PRICE);

        vm.prank(alice);
        vm.expectRevert(Patungan.NothingToRefund.selector);
        pat.claimRefund(id);
        vm.prank(carol);
        vm.expectRevert(Patungan.NothingToRefund.selector);
        pat.claimRefund(id);

        uint256 bobQusdc = qusdc.balanceOf(bob);
        vm.prank(bob);
        pat.claimRefund(id);
        assertEq(qusdc.balanceOf(bob) - bobQusdc, PRICE, "QIE payer gets QUSDC back");
        assertEq(_pool(id).held, 0);
        assertEq(qusdc.balanceOf(address(pat)), 0);
    }

    function test_refundAll_batches_skipsClaimed_exactlyOnce() public {
        uint256 id = _create(10);
        address[5] memory who;
        for (uint256 i; i < 5; ++i) {
            who[i] = makeAddr(string(abi.encodePacked("m", vm.toString(i))));
            qusdc.mint(who[i], 1e6);
            vm.prank(who[i]);
            qusdc.approve(address(pat), type(uint256).max);
            _join(who[i], id, 1);
        }
        vm.expectRevert(Patungan.NotRefundable.selector);
        pat.refundAll(id, 0, 5);
        vm.warp(block.timestamp + 1 days);

        vm.prank(who[1]);
        pat.claimRefund(id); // one member claims alone first
        pat.refundAll(id, 0, 2); // chunk 1: who[0] refunded, who[1] skipped
        assertEq(pat.refundedCount(id), 2);
        pat.refundAll(id, 2, 100); // chunk 2 runs past the end safely
        assertEq(pat.refundedCount(id), 5);
        pat.refundAll(id, 0, 100); // a repeat pays nobody twice
        assertEq(pat.refundedCount(id), 5);
        pat.refundAll(id, 50, 10); // from past the end is a no-op
        for (uint256 i; i < 5; ++i) {
            assertEq(qusdc.balanceOf(who[i]), 1e6);
        }
        assertEq(_pool(id).held, 0);
        assertEq(pat.totalHeld(), 0);
    }

    /// @dev Issuer burn (QUSDC VAULT_ROLE on mainnet): the escrow ends short. refundAll pays in call order until the
    /// balance runs out, then records RefundFailed and leaves the rest claimable; accounting stays exact.
    function test_refundAll_failedTransfer_restoresBalance_andEmitsRefundFailed() public {
        uint256 id = _create(5);
        _join(alice, id, 1);
        _join(bob, id, 1);
        _join(carol, id, 1);
        qusdc.burn(address(pat), 2 * uint256(PRICE)); // only one seat's worth is left
        assertFalse(pat.isSolvent());
        vm.warp(block.timestamp + 1 days);

        vm.expectEmit(address(pat));
        emit Refunded(id, alice, PRICE);
        vm.expectEmit(address(pat));
        emit RefundFailed(id, bob, PRICE);
        vm.expectEmit(address(pat));
        emit RefundFailed(id, carol, PRICE);
        pat.refundAll(id, 0, 10);
        assertEq(pat.refundedCount(id), 1);
        assertEq(pat.paid(id, bob), PRICE, "still claimable");
        assertEq(pat.paid(id, carol), PRICE);
        assertEq(_pool(id).held, 2 * uint256(PRICE));
        assertEq(pat.totalHeld(), 2 * uint256(PRICE));

        qusdc.mint(address(pat), 2 * uint256(PRICE)); // if the issuer ever restores it, the claims complete
        assertTrue(pat.isSolvent());
        vm.prank(bob);
        pat.claimRefund(id);
        pat.refundAll(id, 0, 10);
        assertEq(pat.refundedCount(id), 3);
        assertEq(pat.totalHeld(), 0);
    }

    function test_twoPools_issuerBurn_firstComeFirstPaid() public {
        uint256 a = _create(5);
        uint256 b = _create(5);
        _join(alice, a, 1);
        _join(bob, b, 1);
        qusdc.burn(address(pat), PRICE); // the singleton holds both pools: a burn hits whichever is paid last
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        pat.claimRefund(b); // first come, first paid
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientBalance: pool A's member is the one left short
        pat.claimRefund(a);
        assertEq(pat.paid(a, alice), PRICE, "the revert rolled back: still owed");
        assertFalse(pat.isSolvent());
    }

    // ================================================================ F6 cancel
    function test_cancel_beforeFirstJoin_closesPool() public {
        uint256 id = _create(5);
        vm.expectEmit(address(pat));
        emit PoolCancelled(id);
        vm.prank(organizer);
        pat.cancel(id);
        assertEq(uint8(_pool(id).status), uint8(Patungan.Status.Cancelled));
        assertTrue(pat.isRefundable(id));
        vm.prank(alice);
        vm.expectRevert(Patungan.PoolNotOpen.selector);
        pat.join(id, 1);
        vm.prank(alice);
        vm.expectRevert(Patungan.NothingToRefund.selector);
        pat.claimRefund(id);
        vm.prank(organizer);
        vm.expectRevert(Patungan.PoolNotOpen.selector);
        pat.cancel(id);
    }

    function test_cancel_withMembers_opensRefundsAtOnce() public {
        uint256 id = _create(5);
        _join(alice, id, 1);
        _join(bob, id, 2);
        vm.prank(organizer);
        pat.cancel(id);
        pat.refundAll(id, 0, 25); // no need to wait for the deadline
        assertEq(qusdc.balanceOf(alice), 1_000e6);
        assertEq(qusdc.balanceOf(bob), 1_000e6);
        assertEq(pat.refundedCount(id), 2);
    }

    function test_cancel_rejects() public {
        uint256 id = _create(2);
        vm.prank(alice);
        vm.expectRevert(Patungan.NotOrganizer.selector);
        pat.cancel(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(organizer);
        vm.expectRevert(Patungan.PoolNotOpen.selector); // past the deadline refunds are already open
        pat.cancel(id);
        uint256 id2 = _create(2);
        _join(alice, id2, 2);
        vm.prank(organizer);
        vm.expectRevert(Patungan.PoolNotOpen.selector);
        pat.cancel(id2);
    }

    // ================================================================ views
    function test_getMembers_pages() public {
        uint256 id = _create(5);
        _join(alice, id, 1);
        _join(bob, id, 1);
        _join(carol, id, 2);
        (address[] memory a, uint16[] memory s,) = pat.getMembers(id, 1, 5);
        assertEq(a.length, 2);
        assertEq(a[0], bob);
        assertEq(a[1], carol);
        assertEq(s[1], 2);
        (a,,) = pat.getMembers(id, 7, 5);
        assertEq(a.length, 0);
        (,,, uint256 mc,,) = pat.getPool(id);
        assertEq(mc, 3);
    }

    function test_isRefundable_unknownPool_false() public view {
        assertFalse(pat.isRefundable(7));
    }

    function _str(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; ++i) {
            b[i] = "a";
        }
        return string(b);
    }
}
