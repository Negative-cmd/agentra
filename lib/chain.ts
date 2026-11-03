import { base, baseSepolia } from 'viem/chains';

/** These are application identifiers, not wallet credentials. */
export const BUILDER_CODE = 'bc_lvlczcjt';
export const SUPPLIED_ATTRIBUTION_REFERENCE = '0x62635f6c766c637a636a740b0080218021802180218021802180218021';

const configuredNetwork = process.env.NEXT_PUBLIC_BASE_NETWORK ?? 'base-sepolia';
if (!['base-sepolia', 'base'].includes(configuredNetwork)) {
  throw new Error('NEXT_PUBLIC_BASE_NETWORK must be base-sepolia or base');
}
export const BASE_CHAIN = configuredNetwork === 'base' ? base : baseSepolia;
export const BASE_CONFIG = {
  chainId: BASE_CHAIN.id,
  network: `eip155:${BASE_CHAIN.id}` as `eip155:${number}`,
  label: BASE_CHAIN.name,
  isMainnet: BASE_CHAIN.id === 8453,
  usdcAddress: (BASE_CHAIN.id === 8453
    ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    : '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
  usdcName: BASE_CHAIN.id === 8453 ? 'USD Coin' : 'USDC',
  usdcVersion: '2',
  explorerUrl: BASE_CHAIN.blockExplorers.default.url,
  rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC_URL ?? BASE_CHAIN.rpcUrls.default.http[0],
} as const;
