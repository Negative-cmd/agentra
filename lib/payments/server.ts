import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { BUILDER_CODE as BUILDER_EXTENSION, builderCodeResourceServerExtension, declareBuilderCodeExtension, parseBuilderCodeSuffixFromCalldata } from '@x402/extensions/builder-code';
import type { PaymentRequirements, PaymentRequired, SettleResponse } from '@x402/core/types';
import { createPublicClient, decodeEventLog, erc20Abi, getAddress, http, isAddress, parseAbi, zeroAddress } from 'viem';
import { BASE_CHAIN, BASE_CONFIG, BUILDER_CODE } from '@/lib/chain';
import { ApiError } from '@/lib/api';

export const paymentExtensions = { [BUILDER_EXTENSION]: declareBuilderCodeExtension(BUILDER_CODE) };

export function paymentConfiguration() {
  const recipient = process.env.PAYMENT_RECIPIENT ?? '';
  if (!isAddress(recipient) || recipient.toLowerCase() === zeroAddress) {
    return { enabled: false, reason: 'Payments need a provider recipient address. Free reference tests are available.', recipient: null };
  }
  if (BASE_CONFIG.isMainnet && process.env.ENABLE_MAINNET_PAYMENTS !== 'true') {
    return { enabled: false, reason: 'Mainnet payments require explicit server configuration.', recipient: getAddress(recipient) };
  }
  return { enabled: true, recipient: getAddress(recipient), reason: null };
}

export function requirePaymentConfiguration() {
  const config = paymentConfiguration();
  if (!config.enabled || !config.recipient) throw new ApiError(503, config.reason ?? 'Payments are unavailable');
  return { ...config, recipient: config.recipient };
}

/** Generate protocol requirements using the SDK's EVM token/pricing implementation.
 * Availability is checked separately before a signed payload can be settled.
 */
export async function createPaymentRequirement(amountUnits: bigint): Promise<PaymentRequirements> {
  const config = requirePaymentConfiguration();
  if (amountUnits <= 0n || amountUnits > 1_000_000n) throw new ApiError(400, 'Reference service price is outside the supported limit');
  const price = await new ExactEvmScheme().parsePrice({
    amount: amountUnits.toString(), asset: BASE_CONFIG.usdcAddress,
    extra: { name: BASE_CONFIG.usdcName, version: BASE_CONFIG.usdcVersion },
  }, BASE_CONFIG.network);
  return { scheme: 'exact', network: BASE_CONFIG.network, amount: price.amount, asset: price.asset,
    payTo: config.recipient, maxTimeoutSeconds: 300, extra: price.extra ?? {} };
}

function createServer() {
  const url = new URL(process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator');
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new ApiError(503, 'The payment facilitator must use HTTPS');
  }
  return new x402ResourceServer(new HTTPFacilitatorClient({ url: url.toString(), timeoutMs: 15_000 }))
    .register(BASE_CONFIG.network, new ExactEvmScheme())
    .registerExtension(builderCodeResourceServerExtension);
}

export async function createPaymentChallenge(requirement: PaymentRequirements, resourceUrl: string, description: string): Promise<PaymentRequired> {
  return createServer().createPaymentRequiredResponse([requirement], {
    url: resourceUrl, description, mimeType: 'application/json',
  }, undefined, paymentExtensions);
}

let serverPromise: Promise<x402ResourceServer> | undefined;
let serverLoadedAt = 0;
export async function getPaymentServer() {
  if (!serverPromise || Date.now() - serverLoadedAt > 60_000) {
    serverLoadedAt = Date.now();
    serverPromise = (async () => {
      const server = createServer();
      await server.initialize();
      if (!server.getSupportedKind(2, BASE_CONFIG.network, 'exact')) throw new ApiError(503, 'Facilitator does not support this Base network');
      return server;
    })().catch(error => { serverPromise = undefined; throw error; });
  }
  return serverPromise;
}

/** A facilitator response alone is not enough: independently verify mined USDC
 * Transfer evidence before returning service output or recording SETTLED.
 */
const authorizationEvents = parseAbi(['event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)']);
export async function verifySettlementEvidence(settlement: SettleResponse, buyer: string, recipient: string, amountUnits: bigint, nonce: string) {
  if (!settlement.success || settlement.network !== BASE_CONFIG.network || !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)) {
    throw new Error('Facilitator did not return a successful transaction on the configured network');
  }
  const client = createPublicClient({ chain: BASE_CHAIN, transport: http(process.env.BASE_RPC_URL ?? BASE_CONFIG.rpcUrl, { timeout: 15_000, retryCount: 0 }) });
  const hash = settlement.transaction as `0x${string}`;
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 30_000 });
  if (receipt.status !== 'success') throw new Error('Settlement transaction reverted');
  const matchingTransfer = receipt.logs.some(log => {
    if (log.address.toLowerCase() !== BASE_CONFIG.usdcAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
      return decoded.args.from.toLowerCase() === buyer.toLowerCase() && decoded.args.to.toLowerCase() === recipient.toLowerCase() && decoded.args.value === amountUnits;
    } catch { return false; }
  });
  if (!matchingTransfer) throw new Error('Settlement receipt has no matching official USDC transfer');
  const authorizationUsed = receipt.logs.some(log => {
    if (log.address.toLowerCase() !== BASE_CONFIG.usdcAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: authorizationEvents, eventName: 'AuthorizationUsed', data: log.data, topics: log.topics });
      return decoded.args.authorizer.toLowerCase() === buyer.toLowerCase() && decoded.args.nonce.toLowerCase() === nonce.toLowerCase();
    } catch { return false; }
  });
  if (!authorizationUsed) throw new Error('Settlement did not consume the expected USDC authorization nonce');
  const transaction = await client.getTransaction({ hash });
  const attribution = parseBuilderCodeSuffixFromCalldata(transaction.input);
  return {
    blockNumber: receipt.blockNumber.toString(),
    attribution: { status: attribution?.a === BUILDER_CODE ? 'verified' : 'not-confirmed', appCode: attribution?.a ?? null, schema: attribution ? 2 : null },
  };
}
