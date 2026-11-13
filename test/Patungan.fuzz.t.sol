// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Patungan} from "../src/Patungan.sol";
import {PatunganBase} from "./utils/PatunganBase.sol";

/// @notice Fuzzed seat/price math: any price, any seat count, any split of seats across members.
contract PatunganFuzzTest is PatunganBase {
    /// The payee receives exactly price x seats, however the seats were split, and the escrow ends empty.
    function testFuzz_payout_isExactlyPriceTimesSeats(uint96 price, uint16 seats, uint256 seed) public {
        price = uint96(bound(price, 1, 1e15)); // up to 1e9 QUSDC per seat
        seats = uint16(bound(seats, 2, 100));
        uint256 total = uint256(price) * seats;
        vm.prank(organizer);
        uint256 id = pat.createPool(payee, price, seats, uint40(block.timestamp + 1 days), "fuzz");

        uint16 left = seats;
        uint256 k;
        while (left > 0) {
            address m = address(uint160(uint256(keccak256(abi.encode(seed, k++)))));
            uint16 n = uint16(bound(uint256(keccak256(abi.encode(seed, "n", k))), 1, left));
            qusdc.mint(m, uint256(price) * n);
            vm.startPrank(m);
            qusdc.approve(address(pat), type(uint256).max);
            pat.join(id, n);
            vm.stopPrank();
            left -= n;
            if (left > 0) assertEq(_pool(id).held, uint256(price) * (seats - left));
        }
        assertEq(qusdc.balanceOf(payee), total);
        assertEq(qusdc.balanceOf(address(pat)), 0);
        assertEq(pat.totalHeld(), 0);
        assertEq(uint8(_pool(id).status), uint8(Patungan.Status.Paid));
    }

    /// Refunds return every member exactly what they paid, whatever the split, and empty the escrow.
    function testFuzz_refunds_returnExactlyWhatWasPaid(uint96 price, uint16 seats, uint8 joins, uint256 seed) public {
        price = uint96(bound(price, 1, 1e15));
        seats = uint16(bound(seats, 3, 100));
        joins = uint8(bound(joins, 1, 20));
        vm.prank(organizer);
        uint256 id = pat.createPool(payee, price, seats, uint40(block.timestamp + 1 days), "fuzz");
        uint16 left = seats - 1; // never fill
        address[] memory who = new address[](joins);
        uint256[] memory spent = new uint256[](joins);
        for (uint256 i; i < joins && left > 0; ++i) {
            who[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
            uint16 n = uint16(bound(uint256(keccak256(abi.encode(seed, "n", i))), 1, left));
            qusdc.mint(who[i], uint256(price) * n);
            vm.startPrank(who[i]);
            qusdc.approve(address(pat), type(uint256).max);
            pat.join(id, n);
            vm.stopPrank();
            spent[i] = uint256(price) * n;
            left -= n;
        }
        vm.warp(block.timestamp + 1 days);
        pat.refundAll(id, 0, 100);
        for (uint256 i; i < joins; ++i) {
            if (who[i] != address(0)) assertEq(qusdc.balanceOf(who[i]), spent[i]);
        }
        assertEq(qusdc.balanceOf(address(pat)), 0);
        assertEq(pat.totalHeld(), 0);
    }

    /// Oracle fair value: ceil(amount * 1e20 / answer) for 6-dp QUSDC and an 8-dp feed; the guard ceiling is
    /// floor(fair * (10_000 + maxDevBps) / 10_000).
    function testFuzz_quote_matchesReferenceMath(uint96 price, uint16 n, int256 answer) public {
        price = uint96(bound(price, 1, 1e15));
        n = uint16(bound(n, 1, 100));
        answer = int256(bound(uint256(answer), 1, 1e14)); // up to $1M per QIE
        oracle.set(answer, block.timestamp);
        vm.prank(organizer);
        uint256 id = pat.createPool(payee, price, 100, uint40(block.timestamp + 1 days), "fuzz");
        (uint256 qieIn, uint256 fair, uint256 maxAllowed) = pat.quoteQIE(id, n);
        uint256 amount = uint256(price) * n;
        assertEq(fair, Math.mulDiv(amount, 1e20, uint256(answer), Math.Rounding.Ceil));
        assertGe(fair * uint256(answer), amount * 1e20, "rounded up: never below the exact value");
        assertEq(maxAllowed, fair * (10_000 + DEV_BPS) / 10_000);
        assertEq(qieIn, router.getAmountsIn(amount, _pathLocal())[0]);
    }

    /// A QIE join never leaves native QIE in the contract and never charges more than the router's own quote.
    function testFuzz_joinWithQIE_spendsQuote_returnsRest(uint16 n, uint256 extra) public {
        n = uint16(bound(n, 1, 9));
        uint256 id = _create(10);
        (uint256 qieIn,, uint256 maxAllowed) = pat.quoteQIE(id, n);
        uint256 value = bound(extra, qieIn, 500 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        pat.joinWithQIE{value: value}(id, n, uint40(block.timestamp));
        assertEq(before - alice.balance, qieIn);
        assertLe(qieIn, maxAllowed);
        assertEq(address(pat).balance, 0);
    }

    function _pathLocal() internal view returns (address[] memory p) {
        p = new address[](2);
        (p[0], p[1]) = (wqie, address(qusdc));
    }
}
