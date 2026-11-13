// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";


/// @notice 6-decimal stand-in for QUSDC (a plain OZ ERC20 on mainnet) with an issuer burn, like QUSDC's VAULT_ROLE.
contract MockQUSDC is ERC20 {
    constructor() ERC20("Mock QUSDC", "mQUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @notice Fee-on-transfer token: delivers 1% less than asked (for the TransferShort guard).
contract MockFeeToken is ERC20 {
    constructor() ERC20("Fee", "FEE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @notice Exact-out V2-shaped router at a fixed rate: `qiePerQusdc` wei of QIE per 1 QUSDC (1e6 units).
/// Knobs let tests make it deliver short, overcharge vs its own quote, or refuse to refund.
contract MockRouter {
    address public immutable WETH;
    address public immutable factory = address(0);
    MockQUSDC public immutable qusdc;
    uint256 public qiePerQusdc;
    uint256 public deliverShortBy;
    uint256 public overchargeBps;

    constructor(MockQUSDC q, address wqie, uint256 rate) {
        (qusdc, WETH, qiePerQusdc) = (q, wqie, rate);
    }

    function setRate(uint256 r) external {
        qiePerQusdc = r;
    }

    function setDeliverShortBy(uint256 s) external {
        deliverShortBy = s;
    }

    function setOverchargeBps(uint256 b) external {
        overchargeBps = b;
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path) public view returns (uint256[] memory a) {
        require(path.length == 2 && path[0] == WETH && path[1] == address(qusdc), "path");
        a = new uint256[](2);
        a[0] = (amountOut * qiePerQusdc + 1e6 - 1) / 1e6;
        a[1] = amountOut;
    }

    function getAmountsOut(uint256, address[] calldata) external pure returns (uint256[] memory) {
        revert("unused");
    }

    function swapETHForExactTokens(uint256 amountOut, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory a)
    {
        require(deadline >= block.timestamp, "EXPIRED");
        a = getAmountsIn(amountOut, path);
        a[0] = a[0] * (10_000 + overchargeBps) / 10_000;
        require(a[0] <= msg.value, "EXCESSIVE_INPUT_AMOUNT");
        qusdc.mint(to, amountOut - deliverShortBy);
        if (msg.value > a[0]) {
            (bool ok,) = msg.sender.call{value: msg.value - a[0]}("");
            require(ok, "refund");
        }
    }
}

contract MockZone {
    mapping(bytes32 => address) public owners;

    function set(string calldata name, address owner) external {
        owners[keccak256(bytes(name))] = owner;
    }

    function domainExistsByName(string calldata name, string calldata tld) external view returns (bool) {
        return keccak256(bytes(tld)) == keccak256("qie") && owners[keccak256(bytes(name))] != address(0);
    }

    function domainOwnerByName(string calldata name, string calldata) external view returns (address o) {
        o = owners[keccak256(bytes(name))];
        require(o != address(0), "Domain does not exist");
    }
}

contract MockOracle {
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 a) {
        (answer, updatedAt) = (a, block.timestamp);
    }

    function set(int256 a, uint256 t) external {
        (answer, updatedAt) = (a, t);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "QIE / USDT";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice A member contract that rejects native QIE (for the ForwardFailed path) and can try re-entering.
contract RejectingMember {
    function joinWithQIE(address p, uint256 id, uint16 n, uint40 expiry) external payable {
        (bool ok, bytes memory ret) =
            p.call{value: msg.value}(abi.encodeWithSignature("joinWithQIE(uint256,uint16,uint40)", id, n, expiry));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

contract ReenteringMember {
    address public target;
    uint256 public poolId;
    bool public reentered;
    bytes public lastError;

    function joinWithQIE(address p, uint256 id, uint40 expiry) external payable {
        (target, poolId) = (p, id);
        (bool ok, bytes memory ret) =
            p.call{value: msg.value}(abi.encodeWithSignature("joinWithQIE(uint256,uint16,uint40)", id, 1, expiry));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {
        // try to re-enter while the change is being forwarded; must fail on the guard
        (bool ok, bytes memory ret) = target.call(abi.encodeWithSignature("claimRefund(uint256)", poolId));
        reentered = ok;
        lastError = ret;
    }
}

