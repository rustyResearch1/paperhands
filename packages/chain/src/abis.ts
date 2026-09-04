export const erc20Abi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }],
  },
] as const

export const v3FactoryAbi = [
  {
    type: 'function', name: 'getPool', stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }],
    outputs: [{ type: 'address' }],
  },
] as const

export const v3PoolAbi = [
  {
    type: 'function', name: 'slot0', stateMutability: 'view', inputs: [],
    outputs: [
      { type: 'uint160', name: 'sqrtPriceX96' },
      { type: 'int24', name: 'tick' },
      { type: 'uint16', name: 'observationIndex' },
      { type: 'uint16', name: 'observationCardinality' },
      { type: 'uint16', name: 'observationCardinalityNext' },
      { type: 'uint8', name: 'feeProtocol' },
      { type: 'bool', name: 'unlocked' },
    ],
  },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
  { type: 'function', name: 'tickSpacing', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'event', name: 'Mint',
    inputs: [
      { type: 'address', name: 'sender', indexed: false },
      { type: 'address', name: 'owner', indexed: true },
      { type: 'int24', name: 'tickLower', indexed: true },
      { type: 'int24', name: 'tickUpper', indexed: true },
      { type: 'uint128', name: 'amount', indexed: false },
      { type: 'uint256', name: 'amount0', indexed: false },
      { type: 'uint256', name: 'amount1', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Burn',
    inputs: [
      { type: 'address', name: 'owner', indexed: true },
      { type: 'int24', name: 'tickLower', indexed: true },
      { type: 'int24', name: 'tickUpper', indexed: true },
      { type: 'uint128', name: 'amount', indexed: false },
      { type: 'uint256', name: 'amount0', indexed: false },
      { type: 'uint256', name: 'amount1', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Swap',
    inputs: [
      { type: 'address', name: 'sender', indexed: true },
      { type: 'address', name: 'recipient', indexed: true },
      { type: 'int256', name: 'amount0', indexed: false },
      { type: 'int256', name: 'amount1', indexed: false },
      { type: 'uint160', name: 'sqrtPriceX96', indexed: false },
      { type: 'uint128', name: 'liquidity', indexed: false },
      { type: 'int24', name: 'tick', indexed: false },
    ],
  },
] as const

export const tickLensAbi = [
  {
    type: 'function', name: 'getPopulatedTicksInWord', stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'pool' },
      { type: 'int16', name: 'tickBitmapIndex' },
    ],
    outputs: [
      {
        type: 'tuple[]', name: 'populatedTicks',
        components: [
          { type: 'int24', name: 'tick' },
          { type: 'int128', name: 'liquidityNet' },
          { type: 'uint128', name: 'liquidityGross' },
        ],
      },
    ],
  },
] as const

export const quoterV2Abi = [
  {
    type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple', name: 'params',
        components: [
          { type: 'address', name: 'tokenIn' },
          { type: 'address', name: 'tokenOut' },
          { type: 'uint256', name: 'amountIn' },
          { type: 'uint24', name: 'fee' },
          { type: 'uint160', name: 'sqrtPriceLimitX96' },
        ],
      },
    ],
    outputs: [
      { type: 'uint256', name: 'amountOut' },
      { type: 'uint160', name: 'sqrtPriceX96After' },
      { type: 'uint32', name: 'initializedTicksCrossed' },
      { type: 'uint256', name: 'gasEstimate' },
    ],
  },
] as const

export const v4PoolManagerAbi = [
  {
    type: 'event', name: 'Initialize',
    inputs: [
      { type: 'bytes32', name: 'id', indexed: true },
      { type: 'address', name: 'currency0', indexed: true },
      { type: 'address', name: 'currency1', indexed: true },
      { type: 'uint24', name: 'fee', indexed: false },
      { type: 'int24', name: 'tickSpacing', indexed: false },
      { type: 'address', name: 'hooks', indexed: false },
      { type: 'uint160', name: 'sqrtPriceX96', indexed: false },
      { type: 'int24', name: 'tick', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Swap',
    inputs: [
      { type: 'bytes32', name: 'id', indexed: true },
      { type: 'address', name: 'sender', indexed: true },
      { type: 'int128', name: 'amount0', indexed: false },
      { type: 'int128', name: 'amount1', indexed: false },
      { type: 'uint160', name: 'sqrtPriceX96', indexed: false },
      { type: 'uint128', name: 'liquidity', indexed: false },
      { type: 'int24', name: 'tick', indexed: false },
      { type: 'uint24', name: 'fee', indexed: false },
    ],
  },
  {
    type: 'event', name: 'ModifyLiquidity',
    inputs: [
      { type: 'bytes32', name: 'id', indexed: true },
      { type: 'address', name: 'sender', indexed: true },
      { type: 'int24', name: 'tickLower', indexed: false },
      { type: 'int24', name: 'tickUpper', indexed: false },
      { type: 'int256', name: 'liquidityDelta', indexed: false },
      { type: 'bytes32', name: 'salt', indexed: false },
    ],
  },
] as const

export const v4StateViewAbi = [
  {
    type: 'function', name: 'getSlot0', stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'poolId' }],
    outputs: [
      { type: 'uint160', name: 'sqrtPriceX96' },
      { type: 'int24', name: 'tick' },
      { type: 'uint24', name: 'protocolFee' },
      { type: 'uint24', name: 'lpFee' },
    ],
  },
  {
    type: 'function', name: 'getLiquidity', stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'poolId' }],
    outputs: [{ type: 'uint128', name: 'liquidity' }],
  },
  {
    type: 'function', name: 'getTickBitmap', stateMutability: 'view',
    inputs: [
      { type: 'bytes32', name: 'poolId' },
      { type: 'int16', name: 'tick' },
    ],
    outputs: [{ type: 'uint256', name: 'tickBitmap' }],
  },
  {
    type: 'function', name: 'getTickLiquidity', stateMutability: 'view',
    inputs: [
      { type: 'bytes32', name: 'poolId' },
      { type: 'int24', name: 'tick' },
    ],
    outputs: [
      { type: 'uint128', name: 'liquidityGross' },
      { type: 'int128', name: 'liquidityNet' },
    ],
  },
] as const

export const v3PoolCreatedEvent = {
  type: 'event', name: 'PoolCreated',
  inputs: [
    { type: 'address', name: 'token0', indexed: true },
    { type: 'address', name: 'token1', indexed: true },
    { type: 'uint24', name: 'fee', indexed: true },
    { type: 'int24', name: 'tickSpacing', indexed: false },
    { type: 'address', name: 'pool', indexed: false },
  ],
} as const
