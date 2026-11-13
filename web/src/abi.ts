import { parseAbi } from 'viem'

export const oracleAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
])

export const zoneAbi = parseAbi([
  'function domainExistsByName(string name, string tld) view returns (bool)',
  'function domainOwnerByName(string name, string tld) view returns (address)',
])

export const routerAbi = parseAbi([
  'function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)',
])
