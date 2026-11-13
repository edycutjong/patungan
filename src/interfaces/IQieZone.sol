// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Subset of the QIE Zone `.qie` name registry (verified source on mainnet.qie.digital).
/// Mainnet: 0x9aab56e7727af53A3131985BFB16d845319b7bdc. Names are lowercase labels; the tld is passed
/// separately ("qie"). `domainOwnerByName` reverts for a name that does not exist.
interface IQieZone {
    function domainExistsByName(string calldata name, string calldata tld) external view returns (bool);
    function domainOwnerByName(string calldata name, string calldata tld) external view returns (address);
}
