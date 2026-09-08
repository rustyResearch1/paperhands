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

/** Uniswap v3 NonfungiblePositionManager — the subset we read and write. */
export const nfpmAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address', name: 'owner' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view',
    inputs: [{ type: 'address', name: 'owner' }, { type: 'uint256', name: 'index' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'tokenId' }],
    outputs: [
      { type: 'uint96', name: 'nonce' },
      { type: 'address', name: 'operator' },
      { type: 'address', name: 'token0' },
      { type: 'address', name: 'token1' },
      { type: 'uint24', name: 'fee' },
      { type: 'int24', name: 'tickLower' },
      { type: 'int24', name: 'tickUpper' },
      { type: 'uint128', name: 'liquidity' },
      { type: 'uint256', name: 'feeGrowthInside0LastX128' },
      { type: 'uint256', name: 'feeGrowthInside1LastX128' },
      { type: 'uint128', name: 'tokensOwed0' },
      { type: 'uint128', name: 'tokensOwed1' },
    ],
  },
  {
    type: 'function', name: 'mint', stateMutability: 'payable',
    inputs: [{
      type: 'tuple', name: 'params',
      components: [
        { type: 'address', name: 'token0' }, { type: 'address', name: 'token1' }, { type: 'uint24', name: 'fee' },
        { type: 'int24', name: 'tickLower' }, { type: 'int24', name: 'tickUpper' },
        { type: 'uint256', name: 'amount0Desired' }, { type: 'uint256', name: 'amount1Desired' },
        { type: 'uint256', name: 'amount0Min' }, { type: 'uint256', name: 'amount1Min' },
        { type: 'address', name: 'recipient' }, { type: 'uint256', name: 'deadline' },
      ],
    }],
    outputs: [
      { type: 'uint256', name: 'tokenId' }, { type: 'uint128', name: 'liquidity' },
      { type: 'uint256', name: 'amount0' }, { type: 'uint256', name: 'amount1' },
    ],
  },
  {
    type: 'function', name: 'collect', stateMutability: 'payable',
    inputs: [{
      type: 'tuple', name: 'params',
      components: [
        { type: 'uint256', name: 'tokenId' }, { type: 'address', name: 'recipient' },
        { type: 'uint128', name: 'amount0Max' }, { type: 'uint128', name: 'amount1Max' },
      ],
    }],
    outputs: [{ type: 'uint256', name: 'amount0' }, { type: 'uint256', name: 'amount1' }],
  },
  {
    type: 'function', name: 'decreaseLiquidity', stateMutability: 'payable',
    inputs: [{
      type: 'tuple', name: 'params',
      components: [
        { type: 'uint256', name: 'tokenId' }, { type: 'uint128', name: 'liquidity' },
        { type: 'uint256', name: 'amount0Min' }, { type: 'uint256', name: 'amount1Min' }, { type: 'uint256', name: 'deadline' },
      ],
    }],
    outputs: [{ type: 'uint256', name: 'amount0' }, { type: 'uint256', name: 'amount1' }],
  },
  { type: 'function', name: 'multicall', stateMutability: 'payable', inputs: [{ type: 'bytes[]', name: 'data' }], outputs: [{ type: 'bytes[]' }] },
  { type: 'function', name: 'refundETH', stateMutability: 'payable', inputs: [], outputs: [] },
  { type: 'function', name: 'unwrapWETH9', stateMutability: 'payable', inputs: [{ type: 'uint256', name: 'amountMinimum' }, { type: 'address', name: 'recipient' }], outputs: [] },
  { type: 'function', name: 'sweepToken', stateMutability: 'payable', inputs: [{ type: 'address', name: 'token' }, { type: 'uint256', name: 'amountMinimum' }, { type: 'address', name: 'recipient' }], outputs: [] },
] as const

/** Uniswap SwapRouter02 — exact-input swaps, with ETH wrap/unwrap helpers. */
export const swapRouter02Abi = [
  {
    type: 'function', name: 'exactInputSingle', stateMutability: 'payable',
    inputs: [{
      type: 'tuple', name: 'params',
      components: [
        { type: 'address', name: 'tokenIn' }, { type: 'address', name: 'tokenOut' }, { type: 'uint24', name: 'fee' },
        { type: 'address', name: 'recipient' }, { type: 'uint256', name: 'amountIn' },
        { type: 'uint256', name: 'amountOutMinimum' }, { type: 'uint160', name: 'sqrtPriceLimitX96' },
      ],
    }],
    outputs: [{ type: 'uint256', name: 'amountOut' }],
  },
  {
    type: 'function', name: 'exactInput', stateMutability: 'payable',
    inputs: [{
      type: 'tuple', name: 'params',
      components: [
        { type: 'bytes', name: 'path' }, { type: 'address', name: 'recipient' },
        { type: 'uint256', name: 'amountIn' }, { type: 'uint256', name: 'amountOutMinimum' },
      ],
    }],
    outputs: [{ type: 'uint256', name: 'amountOut' }],
  },
  { type: 'function', name: 'multicall', stateMutability: 'payable', inputs: [{ type: 'bytes[]', name: 'data' }], outputs: [{ type: 'bytes[]' }] },
  { type: 'function', name: 'unwrapWETH9', stateMutability: 'payable', inputs: [{ type: 'uint256', name: 'amountMinimum' }, { type: 'address', name: 'recipient' }], outputs: [] },
  { type: 'function', name: 'refundETH', stateMutability: 'payable', inputs: [], outputs: [] },
] as const

export const erc20WriteAbi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export const v4QuoterAbi = [
  {
    type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple', name: 'params',
        components: [
          {
            type: 'tuple', name: 'poolKey',
            components: [
              { type: 'address', name: 'currency0' },
              { type: 'address', name: 'currency1' },
              { type: 'uint24', name: 'fee' },
              { type: 'int24', name: 'tickSpacing' },
              { type: 'address', name: 'hooks' },
            ],
          },
          { type: 'bool', name: 'zeroForOne' },
          { type: 'uint128', name: 'exactAmount' },
          { type: 'bytes', name: 'hookData' },
        ],
      },
    ],
    outputs: [
      { type: 'uint256', name: 'amountOut' },
      { type: 'uint256', name: 'gasEstimate' },
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
