/** The public-client calls only a write needs: loaded on first use (chain.ts), never with a page's first paint. */
export { estimateContractGas, simulateContract, waitForTransactionReceipt } from 'viem/actions'
