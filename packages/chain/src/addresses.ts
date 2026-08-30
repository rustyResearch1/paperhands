import type { Address } from 'viem'

export const CHAIN_ID = 4663
export const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
export const EXPLORER_URL = 'https://robinhoodchain.blockscout.com'

/**
 * Uniswap deployments on Robinhood Chain, from Uniswap's sdk-core
 * CHAIN_TO_ADDRESSES_MAP (ChainId.ROBINHOOD). Factory/quoter/pool-manager
 * bytecode presence verified on-chain 2026-08-30.
 */
export const UNISWAP = {
  v2Factory: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f' as Address,
  v2Router: '0x89e5db8b5aa49aa85ac63f691524311aeb649eba' as Address,
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' as Address,
  v3Quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7' as Address,
  v3TickLens: '0x7dfd4f31be6814d2906bde155c3e1b146eac1468' as Address,
  v3Multicall: '0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3' as Address,
  swapRouter02: '0xcaf681a66d020601342297493863e78c959e5cb2' as Address,
  positionManager: '0x73991a25c818bf1f1128deaab1492d45638de0d3' as Address,
  v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951' as Address,
  v4StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b' as Address,
  v4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' as Address,
} as const

export const WETH: Address = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'

/** Well-known ecosystem tokens, for seeding discovery and fixtures. */
export const KNOWN_TOKENS: Record<string, Address> = {
  WETH,
  JUGGERNAUT: '0xd7321801CAae694090694Ff55A9323139F043b88',
  STONKBROKER: '0xe934e36A439C94017B64a3FecE66AF12099aBF50',
  PONS: '0x39dbed3a2bd333467115de45665cc57f813c4571',
}

/** JUGGERNAUT/WETH v3 pools discovered via factory.getPool, 2026-08-30. */
export const FIXTURE_POOLS = {
  jugWeth500: '0x5d67c9acd040256c68d3713f28b8343061a2599c' as Address,
  jugWeth3000: '0xbac80c3fdaacd34a9b3524c39353236db1cbb2d9' as Address,
  jugWeth10000: '0x588b0785f50063260003b7790c42f1ef74902746' as Address,
}
