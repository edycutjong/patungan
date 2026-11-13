// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Patungan} from "../../src/Patungan.sol";
import {IQieDexRouter} from "../../src/interfaces/IQieDexRouter.sol";
import {IQieZone} from "../../src/interfaces/IQieZone.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {MockQUSDC, MockRouter, MockZone, MockOracle} from "../mocks/Mocks.sol";

/// @notice Local (no-fork) fixture: Patungan wired to mocks of QUSDC, QIEDEX, Zone and the Oracle.
/// Prices mirror the P0c mainnet read: QIE ≈ $0.1215 on the Oracle, the AMM ≈ 5.5% dearer than that.
abstract contract PatunganBase is Test {
    uint96 internal constant PRICE = 250_000; // 0.25 QUSDC per seat
    uint256 internal constant DEV_BPS = 1_500;
    uint256 internal constant ORACLE_AGE = 172_800;
    int256 internal constant ORACLE_PRICE = 12_150_000; // $0.1215, 8 dp
    // fair = 1e6 * 1e20 / 12_150_000 ≈ 8.2305e18 QIE per QUSDC; the router charges ≈ 5.5% more
    uint256 internal constant ROUTER_RATE = 8_683_000_000_000_000_000;

    MockQUSDC internal qusdc;
    MockRouter internal router;
    MockZone internal zone;
    MockOracle internal oracle;
    Patungan internal pat;

    address internal organizer = makeAddr("organizer");
    address internal payee = makeAddr("payee");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal wqie = makeAddr("wqie");

    function setUp() public virtual {
        vm.warp(1_763_000_000);
        qusdc = new MockQUSDC();
        router = new MockRouter(qusdc, wqie, ROUTER_RATE);
        zone = new MockZone();
        oracle = new MockOracle(ORACLE_PRICE);
        pat = _deploy(IERC20(address(qusdc)));
        zone.set("lapangan", payee);
        address[3] memory who = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            vm.deal(who[i], 1_000 ether);
            qusdc.mint(who[i], 1_000e6);
            vm.prank(who[i]);
            qusdc.approve(address(pat), type(uint256).max);
        }
    }

    function _deploy(IERC20 token) internal returns (Patungan) {
        return new Patungan(
            token,
            IQieDexRouter(address(router)),
            IQieZone(address(zone)),
            IAggregatorV3(address(oracle)),
            DEV_BPS,
            ORACLE_AGE
        );
    }

    function _create(uint16 seats) internal returns (uint256 id) {
        vm.prank(organizer);
        id = pat.createPool(payee, PRICE, seats, uint40(block.timestamp + 1 days), "Futsal Kamis");
    }

    function _join(address who, uint256 id, uint16 n) internal {
        vm.prank(who);
        pat.join(id, n);
    }

    function _joinQIE(address who, uint256 id, uint16 n) internal returns (uint256 spent) {
        (uint256 qieIn,,) = pat.quoteQIE(id, n);
        uint256 before = who.balance;
        vm.prank(who);
        pat.joinWithQIE{value: qieIn * 101 / 100}(id, n, uint40(block.timestamp + 300));
        spent = before - who.balance;
    }

    function _pool(uint256 id) internal view returns (Patungan.Pool memory p) {
        (p,,,,,) = pat.getPool(id);
    }
}
