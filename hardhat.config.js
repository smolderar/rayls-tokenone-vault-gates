// Local EVM used only by checker/check.js to re-execute the logged testnet transactions.
module.exports = {
  solidity: '0.8.24',
  networks: {
    hardhat: { chainId: 7295799, hardfork: 'cancun', throwOnTransactionFailures: false, throwOnCallFailures: true,
      allowBlocksWithSameTimestamp: true, initialBaseFeePerGas: 0, mining: { auto: true } }
  }
};
