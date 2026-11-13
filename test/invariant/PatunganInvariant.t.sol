// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Patungan} from "../../src/Patungan.sol";
import {PatunganBase} from "../utils/PatunganBase.sol";
import {MockQUSDC, MockOracle} from "../mocks/Mocks.sol";

/// @notice Drives random sequences of create / join / joinWithQIE / cancel / warp / claim / refundAll / donate.
contract Handler is Test {
    Patungan public pat;
    MockQUSDC public qusdc;
    MockOracle public oracle;
    address public payee;
    address[] public actors;
    uint256[] public ids;
    mapping(uint256 => uint256) public refundedSum; // ghost: Σ Refunded amounts per pool
    uint256 public paidOutSum; // ghost: Σ PoolPaid totals

    constructor(Patungan p, MockQUSDC q, MockOracle o, address payee_) {
        (pat, qusdc, oracle, payee) = (p, q, o, payee_);
        for (uint256 i; i < 6; ++i) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(a);
            vm.deal(a, 1e30);
            q.mint(a, 1e24);
            vm.prank(a);
            q.approve(address(p), type(uint256).max);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function create(uint256 actorSeed, uint96 price, uint16 seats, uint32 duration) external {
        price = uint96(bound(price, 1, 1e9));
        seats = uint16(bound(seats, 2, 12));
        duration = uint32(bound(duration, 10 minutes, 3 days));
        vm.prank(_actor(actorSeed));
        ids.push(pat.createPool(payee, price, seats, uint40(block.timestamp + duration), "inv"));
    }

    function join(uint256 actorSeed, uint256 idSeed, uint16 n) external {
        (uint256 id, bool ok) = _joinable(idSeed);
        if (!ok) return;
        Patungan.Pool memory p = _pool(id);
        n = uint16(bound(n, 1, p.seats - p.filled));
        _beforePayout(id, n);
        vm.prank(_actor(actorSeed));
        pat.join(id, n);
    }

    function joinWithQIE(uint256 actorSeed, uint256 idSeed, uint16 n) external {
        (uint256 id, bool ok) = _joinable(idSeed);
        if (!ok) return;
        Patungan.Pool memory p = _pool(id);
        n = uint16(bound(n, 1, p.seats - p.filled));
        oracle.set(oracle.answer(), block.timestamp); // a live feed (staleness has its own unit test)
        (uint256 qieIn,,) = pat.quoteQIE(id, n);
        _beforePayout(id, n);
        vm.prank(_actor(actorSeed));
        pat.joinWithQIE{value: qieIn * 101 / 100}(id, n, uint40(block.timestamp));
    }

    function cancel(uint256 idSeed) external {
        (uint256 id, bool ok) = _joinable(idSeed);
        if (!ok) return;
        vm.prank(_pool(id).organizer);
        pat.cancel(id);
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function claim(uint256 actorSeed, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address a = _actor(actorSeed);
        uint256 owed = pat.paid(id, a);
        if (!pat.isRefundable(id) || owed == 0) return;
        vm.prank(a);
        pat.claimRefund(id);
        refundedSum[id] += owed;
    }

    function refundAll(uint256 idSeed, uint8 from, uint8 count) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (!pat.isRefundable(id)) return;
        uint256 heldBefore = _pool(id).held;
        pat.refundAll(id, bound(from, 0, 6), bound(count, 0, 6));
        refundedSum[id] += heldBefore - _pool(id).held;
    }

    /// Anyone can send QUSDC to the contract directly; it must never be counted as anyone's money.
    function donate(uint256 actorSeed, uint32 amount) external {
        vm.prank(_actor(actorSeed));
        qusdc.transfer(address(pat), bound(amount, 1, 1e6));
    }

    function _beforePayout(uint256 id, uint16 n) internal {
        Patungan.Pool memory p = _pool(id);
        if (p.filled + n == p.seats) paidOutSum += uint256(p.price) * p.seats;
    }

    function _joinable(uint256 idSeed) internal view returns (uint256 id, bool ok) {
        if (ids.length == 0) return (0, false);
        id = ids[idSeed % ids.length];
        Patungan.Pool memory p = _pool(id);
        ok = p.status == Patungan.Status.Open && block.timestamp < p.deadline;
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function _pool(uint256 id) internal view returns (Patungan.Pool memory p) {
        (p,,,,,) = pat.getPool(id);
    }
}

/// @notice Protocol invariants (architecture.md): conservation, exclusive outcome, no native QIE left behind.
contract PatunganInvariantTest is PatunganBase {
    Handler internal h;

    function setUp() public override {
        super.setUp();
        h = new Handler(pat, qusdc, oracle, payee);
        targetContract(address(h));
    }

    /// escrow QUSDC balance ≥ totalHeld == Σ held[p]  (≥: direct donations)
    function invariant_conservation_totalHeld() public view {
        uint256 sum;
        for (uint256 i; i < h.idsLength(); ++i) {
            sum += _pool(h.ids(i)).held;
        }
        assertEq(pat.totalHeld(), sum, "totalHeld == sum of held");
        assertGe(qusdc.balanceOf(address(pat)), pat.totalHeld(), "solvent");
        assertTrue(pat.isSolvent());
    }

    /// per pool: held == Σ paid[m] while Open/Cancelled; held == 0 once Paid;
    /// price·filled == held + refunded until paid; payee gets exactly price·seats per paid pool.
    function invariant_conservation_perPool() public view {
        for (uint256 i; i < h.idsLength(); ++i) {
            uint256 id = h.ids(i);
            (Patungan.Pool memory p,,, uint256 mc,,) = pat.getPool(id);
            if (p.status == Patungan.Status.Paid) {
                assertEq(p.held, 0, "paid pool holds nothing");
                assertEq(p.filled, p.seats);
                assertEq(h.refundedSum(id), 0, "exclusive outcome: a paid pool refunded nobody");
                continue;
            }
            (,, uint256[] memory owed) = pat.getMembers(id, 0, mc);
            uint256 sum;
            for (uint256 j; j < owed.length; ++j) {
                sum += owed[j];
            }
            assertEq(p.held, sum, "held == sum of paid");
            assertEq(uint256(p.price) * p.filled, p.held + h.refundedSum(id), "nothing lost, nothing created");
        }
        assertEq(qusdc.balanceOf(payee), h.paidOutSum(), "payee received exactly the filled pools");
    }

    function invariant_noNativeQieSticks() public view {
        assertEq(address(pat).balance, 0);
    }
}
