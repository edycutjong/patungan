// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Chainlink-shaped price feed. QIE Oracle QIE/USDT feed on mainnet:
/// 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17 (8 decimals). `latestAnswer()` reverts on this feed;
/// use `latestRoundData()` only.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
