// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IQieDexRouter} from "../../src/interfaces/IQieDexRouter.sol";
import {IQieZone} from "../../src/interfaces/IQieZone.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice Day-one spike: the smallest escrow that touches all four QIE components from a contract.
/// Not the product contract (that is src/Patungan.sol). One seat per join, no meta, no batch refunds.
/// It exists to prove, against real mainnet state on a fork, that:
///   - QUSDC transferFrom into escrow, release to the payee and refund all work;
///   - a CONTRACT can call QIEDEX swapETHForExactTokens, receive the unspent QIE back and forward it;
///   - the QIE Oracle bounds the swap; a Zone `.qie` name resolves to the payee.
contract SpikeEscrow {
    using SafeERC20 for IERC20;

    error BadParams();
    error NotOpen();
    error NotRefundable();
    error PriceDeviation(uint256 fairQie, uint256 qieIn);
    error OracleStale();
    error ForwardFailed();
    error OnlyRouter();

    struct Pool {
        address payee;
        uint96 price;
        uint40 deadline;
        uint16 seats;
        uint16 filled;
        bool paid;
    }

    IERC20 public immutable qusdc;
    IQieDexRouter public immutable router;
    IQieZone public immutable zone;
    IAggregatorV3 public immutable oracle;
    address public immutable wqie;
    uint256 public immutable maxDevBps;
    uint256 public immutable maxOracleAge;

    uint256 public nextId;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => mapping(address => uint256)) public paidBy;

    constructor(IERC20 q, IQieDexRouter r, IQieZone z, IAggregatorV3 o, uint256 devBps, uint256 oracleAge) {
        (qusdc, router, zone, oracle, maxDevBps, maxOracleAge) = (q, r, z, o, devBps, oracleAge);
        wqie = r.WETH();
    }

    function createByName(string calldata name, uint96 price, uint16 seats, uint40 deadline)
        external
        returns (uint256 id)
    {
        address payee = zone.domainOwnerByName(name, "qie"); // reverts for an unknown name
        if (payee == address(0) || seats < 2 || price == 0 || deadline <= block.timestamp) revert BadParams();
        id = ++nextId;
        pools[id] = Pool(payee, price, deadline, seats, 0, false);
    }

    function join(uint256 id) external {
        Pool storage p = _open(id);
        qusdc.safeTransferFrom(msg.sender, address(this), p.price);
        _seat(id, p);
    }

    function joinWithQIE(uint256 id) external payable {
        Pool storage p = _open(id);
        address[] memory path = new address[](2);
        (path[0], path[1]) = (wqie, address(qusdc));

        (, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        if (answer <= 0 || block.timestamp - updatedAt > maxOracleAge) revert OracleStale();
        // QUSDC has 6 decimals, the oracle 8, QIE 18: fairQie = price * 10^(8+18-6) / answer
        uint256 fairQie = Math.mulDiv(p.price, 1e20, uint256(answer), Math.Rounding.Ceil);
        uint256 qieIn = router.getAmountsIn(p.price, path)[0];
        if (qieIn * 10_000 > fairQie * (10_000 + maxDevBps)) revert PriceDeviation(fairQie, qieIn);

        uint256 before = qusdc.balanceOf(address(this));
        uint256 spent = router.swapETHForExactTokens{value: msg.value}(p.price, path, address(this), block.timestamp)[0];
        require(qusdc.balanceOf(address(this)) - before >= p.price, "swap short");
        if (msg.value > spent) {
            (bool ok,) = msg.sender.call{value: msg.value - spent}("");
            if (!ok) revert ForwardFailed();
        }
        _seat(id, p);
    }

    function refund(uint256 id) external {
        Pool storage p = pools[id];
        if (p.paid || block.timestamp < p.deadline) revert NotRefundable();
        uint256 amt = paidBy[id][msg.sender];
        if (amt == 0) revert NotRefundable();
        paidBy[id][msg.sender] = 0;
        qusdc.safeTransfer(msg.sender, amt);
    }

    receive() external payable {
        if (msg.sender != address(router)) revert OnlyRouter();
    }

    function _open(uint256 id) private view returns (Pool storage p) {
        p = pools[id];
        if (p.payee == address(0) || p.paid || block.timestamp >= p.deadline || p.filled >= p.seats) revert NotOpen();
    }

    function _seat(uint256 id, Pool storage p) private {
        paidBy[id][msg.sender] += p.price;
        if (++p.filled == p.seats) {
            p.paid = true;
            qusdc.safeTransfer(p.payee, uint256(p.price) * p.seats); // last seat pays the payee in the same tx
        }
    }
}
