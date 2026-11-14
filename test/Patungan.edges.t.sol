// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Patungan} from "../src/Patungan.sol";
import {IQieDexRouter} from "../src/interfaces/IQieDexRouter.sol";
import {IQieZone} from "../src/interfaces/IQieZone.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {PatunganBase} from "./utils/PatunganBase.sol";
import {MockQUSDC} from "./mocks/Mocks.sol";

/// @notice A stablecoin with more decimals than the Oracle's 8 + QIE's 18 (exercises the scale-down branch).
contract Token30 is ERC20 {
    constructor() ERC20("Thirty", "T30") {}

    function decimals() public pure override returns (uint8) {
        return 30;
    }
}

/// @notice A Zone that says a name exists but returns the zero address as its owner.
contract ZeroOwnerZone {
    function domainExistsByName(string calldata, string calldata) external pure returns (bool) {
        return true;
    }

    function domainOwnerByName(string calldata, string calldata) external pure returns (address) {
        return address(0);
    }
}

/// @notice A hostile router that delivers the QUSDC but drains native QIE from the caller beyond what it was sent.
/// Simulated with the `deal` cheatcode, since a real EVM call cannot take more than msg.value.
contract DrainingRouter {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address public immutable WETH;
    MockQUSDC public immutable qusdc;
    uint256 public immutable qiePerQusdc;

    constructor(MockQUSDC q, address wqie, uint256 rate) {
        (qusdc, WETH, qiePerQusdc) = (q, wqie, rate);
    }

    function getAmountsIn(uint256 amountOut, address[] calldata) public view returns (uint256[] memory a) {
        a = new uint256[](2);
        a[0] = (amountOut * qiePerQusdc + 1e6 - 1) / 1e6;
        a[1] = amountOut;
    }

    function swapETHForExactTokens(uint256 amountOut, address[] calldata, address to, uint256)
        external
        payable
        returns (uint256[] memory a)
    {
        a = new uint256[](2);
        (a[0], a[1]) = (msg.value, amountOut);
        qusdc.mint(to, amountOut);
        VM.deal(msg.sender, msg.sender.balance - 1); // one wei more than it was given leaves the caller
    }
}

/// @notice Edge branches the main suite does not reach: each test is named for the defence it pins.
contract PatunganEdgesTest is PatunganBase {
    function test_constructor_tokenWithMoreDecimalsThanOraclePlus18_scalesFairValueDown() public {
        Token30 t30 = new Token30();
        Patungan p = new Patungan(
            IERC20(address(t30)),
            IQieDexRouter(address(router)),
            IQieZone(address(zone)),
            IAggregatorV3(address(oracle)),
            DEV_BPS,
            ORACLE_AGE
        );
        assertEq(p.qusdcDecimals(), 30);
        assertEq(p.oracleDecimals(), 8);
    }

    function test_createPoolByName_nameExistsButOwnerIsZero_revertsPayeeNotFound() public {
        Patungan p = new Patungan(
            IERC20(address(qusdc)),
            IQieDexRouter(address(router)),
            IQieZone(address(new ZeroOwnerZone())),
            IAggregatorV3(address(oracle)),
            DEV_BPS,
            ORACLE_AGE
        );
        vm.prank(organizer);
        vm.expectRevert(Patungan.PayeeNotFound.selector);
        p.createPoolByName("ghost", address(0), PRICE, 3, uint40(block.timestamp + 1 days), "Ghost court");
    }

    function test_joinWithQIE_routerDrainsMoreNativeThanCeiling_revertsPriceDeviation() public {
        DrainingRouter dr = new DrainingRouter(qusdc, wqie, ROUTER_RATE);
        Patungan p = new Patungan(
            IERC20(address(qusdc)),
            IQieDexRouter(address(dr)),
            IQieZone(address(zone)),
            IAggregatorV3(address(oracle)),
            DEV_BPS,
            ORACLE_AGE
        );
        vm.prank(organizer);
        uint256 id = p.createPool(payee, PRICE, 3, uint40(block.timestamp + 1 days), "Thursday football");
        (, uint256 fair, uint256 ceiling) = p.quoteQIE(id, 1);
        vm.deal(address(p), 1 ether); // unrelated native balance the drain can reach into
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Patungan.PriceDeviation.selector, fair, ceiling + 1));
        p.joinWithQIE{value: 100 ether}(id, 1, uint40(block.timestamp));
    }
}
