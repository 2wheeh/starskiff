import path from 'node:path'

export const marooFixtures = {
  testnetGenesis: path.join(import.meta.dirname, 'privacy-genesis.testnet.json'),
  mainnetGenesis: path.join(import.meta.dirname, 'privacy-genesis.mainnet.json'),
  directory: import.meta.dirname,
}
