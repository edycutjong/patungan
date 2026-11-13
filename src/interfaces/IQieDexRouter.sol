// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Subset of the QIEDEX router (standard Uniswap V2 interface) used by Patungan.
/// Mainnet router: 0x08cd2e72e156D8563B4351eb4065C262A9f553Ef (chain 1990).
interface IQieDexRouter {
    function WETH() external view returns (address);
    function factory() external view returns (address);

    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    function swapETHForExactTokens(uint256 amountOut, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
}
