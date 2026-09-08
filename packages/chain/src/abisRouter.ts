/** Universal Router + Permit2 — the pieces a wallet needs to swap through v4. */
export const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { type: 'bytes', name: 'commands' },
      { type: 'bytes[]', name: 'inputs' },
      { type: 'uint256', name: 'deadline' },
    ],
    outputs: [],
  },
] as const

export const permit2Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'address', name: 'token' },
      { type: 'address', name: 'spender' },
      { type: 'uint160', name: 'amount' },
      { type: 'uint48', name: 'expiration' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'user' },
      { type: 'address', name: 'token' },
      { type: 'address', name: 'spender' },
    ],
    outputs: [
      { type: 'uint160', name: 'amount' },
      { type: 'uint48', name: 'expiration' },
      { type: 'uint48', name: 'nonce' },
    ],
  },
] as const
