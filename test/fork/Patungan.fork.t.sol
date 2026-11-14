// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/console2.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QieMainnet} from "../utils/QieMainnet.sol";
import {Patungan} from "../../src/Patungan.sol";
import {IQieDexRouter} from "../../src/interfaces/IQieDexRouter.sol";
import {IQieZone} from "../../src/interfaces/IQieZone.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

interface IQusdcIssuer {
    function burn(address from, uint256 amount) external;
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @notice The product contract against real QIE mainnet state (fork of the latest block): real QUSDC, the live
/// QIEDEX router and WQIE/QUSDC pair, a real `.qie` name, the live QIE Oracle feed.
/// Run: forge test --match-path 'test/fork/*' -vv   (QIE_RPC_URL optional; defaults to rpc1mainnet)
contract PatunganForkTest is QieMainnet {
    using stdStorage for StdStorage;

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

    IERC20 qusdc = IERC20(QUSDC);
    IQieDexRouter router = IQieDexRouter(ROUTER);
    Patungan pat;

    uint96 constant PRICE = 250_000; // 0.25 QUSDC
    uint256 constant DEV_BPS = 1_500;
    uint256 constant ORACLE_AGE = 172_800;
    string constant NAME = "test"; // a real `.qie` name (P0c); read-only demo payee, fork only
    // Resolved live in setUp: names are transferable NFTs (the P0c read was 0x2220541bC5506E01be95bdc82297Fbf061df132A),
    // so a transfer of `test.qie` changes the fixture, not the result.
    address NAME_OWNER;

    address organizer = makeAddr("organizer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        _forkQie();
        NAME_OWNER = IQieZone(ZONE).domainOwnerByName(NAME, "qie");
        pat = new Patungan(qusdc, router, IQieZone(ZONE), IAggregatorV3(ORACLE_QIE_USD), DEV_BPS, ORACLE_AGE);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function test_fork_constructor_readsLiveDecimalsAndWqie() public view {
        assertEq(pat.wqie(), WQIE);
        assertEq(pat.oracleDecimals(), 8);
        assertEq(pat.qusdcDecimals(), 6);
    }

    function test_fork_createPoolByName_realName_snapshotsOwner() public {
        vm.prank(organizer);
        uint256 id =
            pat.createPoolByName(NAME, NAME_OWNER, PRICE, 3, uint40(block.timestamp + 1 days), "Thursday football");
        (Patungan.Pool memory p, string memory title, string memory payeeName,,,) = pat.getPool(id);
        assertEq(p.payee, NAME_OWNER);
        assertEq(payeeName, NAME);
        assertEq(title, "Thursday football");
    }

    function test_fork_createPoolByName_wrongExpected_revertsPayeeChanged() public {
        vm.expectRevert(abi.encodeWithSelector(Patungan.PayeeChanged.selector, NAME_OWNER));
        pat.createPoolByName(NAME, alice, PRICE, 3, uint40(block.timestamp + 1 days), "t");
    }

    function test_fork_createPoolByName_unknownName_revertsPayeeNotFound() public {
        vm.expectRevert(Patungan.PayeeNotFound.selector);
        pat.createPoolByName("patungan-no-such-name-xyz", alice, PRICE, 3, uint40(block.timestamp + 1 days), "t");
    }

    function test_fork_quoteQIE_matchesRouterAndOracle() public {
        uint256 id = _createByName(3);
        (uint256 qieIn, uint256 fair, uint256 maxAllowed) = pat.quoteQIE(id, 2);
        assertEq(qieIn, router.getAmountsIn(2 * uint256(PRICE), _path())[0]);
        (, int256 answer,,,) = IAggregatorV3(ORACLE_QIE_USD).latestRoundData();
        assertEq(fair, (2 * uint256(PRICE) * 1e20 + uint256(answer) - 1) / uint256(answer));
        assertEq(maxAllowed, fair * 11_500 / 10_000);
        assertLe(qieIn, maxAllowed, "live spread inside the 15% deploy-default guard");
        console2.log("2 seats: router QIE in", qieIn);
        console2.log("2 seats: oracle fair QIE", fair);
        // signed: the one-sided guard also admits a router that is cheaper than the Oracle (a discount)
        console2.log("router premium over oracle (bps)", int256((qieIn * 10_000) / fair) - 10_000);
    }

    /// The whole PAID path on real state: a QUSDC join, a QIE join, then a QIE join fills the last seat and pays the
    /// real `.qie` owner in the same tx; no native QIE stays in the contract.
    function test_fork_fullFlow_qusdcAndQie_lastSeatPaysRealName() public {
        uint256 id = _createByName(3);
        _buyQusdcAndJoin(alice, id, 1);
        _joinQIE(bob, id, 1);

        (uint256 qieIn,,) = pat.quoteQIE(id, 1);
        (, int256 answer,,,) = IAggregatorV3(ORACLE_QIE_USD).latestRoundData();
        uint256 payeeBefore = qusdc.balanceOf(NAME_OWNER);
        uint256 carolBefore = carol.balance;
        vm.expectEmit(address(pat));
        emit Joined(id, carol, 1, PRICE, true, qieIn, uint256(answer));
        vm.expectEmit(address(pat));
        emit PoolPaid(id, NAME_OWNER, 3 * uint256(PRICE));
        vm.prank(carol);
        pat.joinWithQIE{value: qieIn * 101 / 100}(id, 1, uint40(block.timestamp + 300));

        assertEq(carolBefore - carol.balance, qieIn, "carol paid the router quote, the 1% tolerance came back");
        assertEq(qusdc.balanceOf(NAME_OWNER) - payeeBefore, 3 * uint256(PRICE), "real .qie owner paid in full");
        assertEq(qusdc.balanceOf(address(pat)), 0);
        assertEq(address(pat).balance, 0);
        assertEq(pat.totalHeld(), 0);
        (Patungan.Pool memory p,,,,,) = pat.getPool(id);
        assertEq(uint8(p.status), uint8(Patungan.Status.Paid));
    }

    /// The REFUNDED path on real state: QIE and QUSDC payers both get QUSDC back after the deadline.
    function test_fork_deadlineRefund_claimAndBatch() public {
        uint256 id = _createByName(5);
        _buyQusdcAndJoin(alice, id, 2);
        _joinQIE(bob, id, 1);
        _joinQIE(carol, id, 1);
        assertEq(qusdc.balanceOf(address(pat)), 4 * uint256(PRICE));
        vm.warp(block.timestamp + 1 days);

        uint256 a0 = qusdc.balanceOf(alice);
        vm.prank(alice);
        pat.claimRefund(id);
        assertEq(qusdc.balanceOf(alice) - a0, 2 * uint256(PRICE));
        pat.refundAll(id, 0, 25); // skips alice, refunds bob + carol in QUSDC
        assertEq(qusdc.balanceOf(bob), PRICE);
        assertEq(qusdc.balanceOf(carol), PRICE);
        assertEq(pat.refundedCount(id), 3);
        assertEq(qusdc.balanceOf(address(pat)), 0);
        assertTrue(pat.isSolvent());
    }

    /// Residual risk, documented: QUSDC's issuer (VAULT_ROLE) can burn from any address, including this escrow. With
    /// two pools in the singleton, refunds then succeed in call order until the balance runs out; the member left
    /// short keeps a claimable balance (refundAll records RefundFailed) and accounting stays exact. New joins refuse
    /// (Insolvent) while the balance is below totalHeld, so no later member's deposit fills the hole.
    function test_fork_twoPools_issuerBurn_firstComeFirstPaid() public {
        bytes32 vaultRole = keccak256("VAULT_ROLE");
        address vault = makeAddr("vault");
        stdstore.target(QUSDC).sig("hasRole(bytes32,address)").with_key(vaultRole).with_key(vault).checked_write(true);
        assertTrue(IQusdcIssuer(QUSDC).hasRole(vaultRole, vault));

        uint256 a = _createByName(5);
        uint256 b = _createByName(5);
        _buyQusdcAndJoin(alice, a, 1);
        _buyQusdcAndJoin(bob, b, 1);
        vm.prank(vault);
        IQusdcIssuer(QUSDC).burn(address(pat), PRICE);
        assertFalse(pat.isSolvent());
        // no new deposit can backfill the hole: both join paths refuse while the escrow is short
        uint256 c = _createByName(5);
        vm.prank(carol);
        vm.expectRevert(Patungan.Insolvent.selector);
        pat.joinWithQIE{value: 10 ether}(c, 1, uint40(block.timestamp + 300));
        vm.warp(block.timestamp + 1 days);

        pat.refundAll(b, 0, 25); // first come, first paid
        assertEq(qusdc.balanceOf(bob), PRICE);
        pat.refundAll(a, 0, 25); // nothing left: alice's transfer fails, her balance stays claimable
        assertEq(pat.paid(a, alice), PRICE);
        assertEq(pat.totalHeld(), PRICE);
        assertEq(qusdc.balanceOf(address(pat)), 0);
    }

    // ---------------------------------------------------------------- helpers
    function _createByName(uint16 seats) internal returns (uint256 id) {
        vm.prank(organizer);
        id = pat.createPoolByName(NAME, NAME_OWNER, PRICE, seats, uint40(block.timestamp + 1 days), "fork pool");
    }

    function _buyQusdcAndJoin(address who, uint256 id, uint16 n) internal {
        uint256 amount = uint256(PRICE) * n;
        vm.startPrank(who);
        router.swapETHForExactTokens{value: 50 ether}(amount, _path(), who, block.timestamp);
        qusdc.approve(address(pat), amount);
        pat.join(id, n);
        vm.stopPrank();
    }

    function _joinQIE(address who, uint256 id, uint16 n) internal {
        (uint256 qieIn,,) = pat.quoteQIE(id, n);
        vm.prank(who);
        pat.joinWithQIE{value: qieIn * 101 / 100}(id, n, uint40(block.timestamp + 300));
    }
}
