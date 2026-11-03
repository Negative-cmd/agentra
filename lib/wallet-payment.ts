'use client';

import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { PaymentRequiredSchema } from '@x402/core/schemas';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import type { ClientEvmSigner } from '@x402/evm';
import type { PaymentRequired } from '@x402/core/types';
import type { WalletClient } from 'viem';
import { BASE_CONFIG } from '@/lib/chain';
import { assertMatchesRequirements } from '@/lib/payments/policy';
import type { ServiceKind } from '@/lib/services';

export type PaidResult = {
  execution: { id: string; status: string; error?: string | null; [key: string]: unknown };
  result: unknown;
  payment: { status: string; txHash?: string | null; receipt?: unknown; [key: string]: unknown } | null;
};
export type PaymentQuote = {
  service: ServiceKind;
  input: unknown;
  workflowStepId?: string;
  idempotencyKey: string;
  paymentRequired: PaymentRequired;
  amountUnits: string;
  recipient: string;
  network: string;
  expiresAt: number;
  recovered?: PaidResult;
};
export type PendingPayment = { service: ServiceKind; input: unknown; workflowStepId?: string; idempotencyKey: string; buyerAddress: string };
const pendingStorageKey = 'agentra.pending.v1';
function stableInput(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableInput).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableInput((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function pendingPayments(buyerAddress?: string): PendingPayment[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(pendingStorageKey) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((entry): entry is PendingPayment => !!entry && typeof entry === 'object' && typeof entry.idempotencyKey === 'string' && ['summary', 'analysis', 'extraction'].includes(entry.service) && typeof entry.buyerAddress === 'string')
      .filter(entry => !buyerAddress || entry.buyerAddress.toLowerCase() === buyerAddress.toLowerCase());
  } catch { return []; }
}
function savePending(entry: PendingPayment) {
  const records = pendingPayments().filter(value => value.idempotencyKey !== entry.idempotencyKey);
  sessionStorage.setItem(pendingStorageKey, JSON.stringify([...records.slice(-19), entry]));
}
function clearPending(key: string) {
  try { sessionStorage.setItem(pendingStorageKey, JSON.stringify(pendingPayments().filter(value => value.idempotencyKey !== key))); } catch { /* history remains the durable source */ }
}
/** Recover an existing request without creating or signing a payment payload. */
export async function recoverPaidExecution(pending: Pick<PendingPayment, 'service' | 'input' | 'idempotencyKey' | 'workflowStepId'>): Promise<PaidResult> {
  const response = await fetch(`/api/services/${pending.service}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.idempotencyKey }, body: requestBody(pending) });
  const data = await response.json();
  if (data.execution && [200, 202, 422].includes(response.status)) {
    if (data.execution.status === 'COMPLETED' || data.execution.status === 'FAILED') clearPending(pending.idempotencyKey);
    return data as PaidResult;
  }
  throw new Error(errorMessage(data, response.status === 402 ? 'This request has no recorded execution yet. Reuse its original request key if you retry; do not start another purchase.' : 'Unable to recover the execution'));
}

function requestBody(quote: { input: unknown; workflowStepId?: string }) {
  return JSON.stringify({ input: quote.input, ...(quote.workflowStepId ? { workflowStepId: quote.workflowStepId } : {}) });
}
function errorMessage(value: unknown, fallback: string) {
  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : fallback;
}

/** A quote request never signs or pays. Display its exact amount and recipient. */
export async function fetchPaymentQuote(service: string, input: unknown, idempotencyKey: string, workflowStepId?: string): Promise<PaymentQuote> {
  if (!['summary', 'analysis', 'extraction'].includes(service)) throw new Error('This service does not support marketplace payments');
  const selectedService = service as ServiceKind;
  const snapshot = JSON.parse(JSON.stringify(input));
  const response = await fetch(`/api/services/${service}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: requestBody({ input: snapshot, workflowStepId }) });
  const data = await response.json();
  if (response.status !== 402) {
    if (response.ok && data.execution?.status === 'COMPLETED') {
      return { service: selectedService, input: snapshot, workflowStepId, idempotencyKey, recovered: data, paymentRequired: {} as PaymentRequired,
        amountUnits: data.payment?.amountUnits ?? '0', recipient: data.payment?.recipient ?? '', network: data.payment?.network ?? BASE_CONFIG.network, expiresAt: Date.now() };
    }
    if (response.status === 202) throw new Error(`Execution ${data.execution?.id ?? ''} is ${data.execution?.status ?? 'pending'}. Keep this request key; do not authorize another payment.`);
    throw new Error(errorMessage(data, `Unable to obtain a payment quote (${response.status})`));
  }
  const header = response.headers.get('PAYMENT-REQUIRED');
  if (!header) throw new Error('Server did not supply the x402 payment requirements header');
  const parsed = PaymentRequiredSchema.parse(decodePaymentRequiredHeader(header));
  if (parsed.x402Version !== 2 || parsed.accepts.length !== 1) throw new Error('Unsupported payment quote');
  const paymentRequired = parsed as PaymentRequired;
  const terms = paymentRequired.accepts[0];
  if (terms.network !== BASE_CONFIG.network || terms.asset.toLowerCase() !== BASE_CONFIG.usdcAddress.toLowerCase() || terms.scheme !== 'exact') throw new Error('Quote is not for official USDC on the selected Base network');
  if (!/^\d+$/.test(terms.amount) || BigInt(terms.amount) <= 0n || BigInt(terms.amount) > 1_000_000n) throw new Error('Quote exceeds the $1 per-payment reference service safety limit');
  return { service: selectedService, input: snapshot, workflowStepId, idempotencyKey, paymentRequired,
    amountUnits: terms.amount, recipient: terms.payTo, network: terms.network, expiresAt: Date.now() + 300_000 };
}

/** Call only from an explicit Approve payment action after showing quote terms.
 * The browser wallet signs a bounded EIP-3009 authorization; no key is stored,
 * no ERC-20 allowance is requested, and there is no background spending.
 */
export async function authorizeAndExecute(quote: PaymentQuote, walletClient: WalletClient, options?: { onStatus?: (status: string) => void }): Promise<PaidResult> {
  if (quote.recovered) { options?.onStatus?.('Completed'); return quote.recovered; }
  if (Date.now() > quote.expiresAt) throw new Error('Quote expired. Request and review a new quote.');
  const terms = quote.paymentRequired.accepts[0];
  if (terms.amount !== quote.amountUnits || terms.payTo !== quote.recipient || terms.network !== quote.network) throw new Error('Reviewed payment terms have changed');
  if (await walletClient.getChainId() !== BASE_CONFIG.chainId) throw new Error(`Switch your wallet to ${BASE_CONFIG.label} before authorizing payment`);
  const account = walletClient.account ?? (await walletClient.getAddresses())[0];
  const accountAddress = typeof account === 'string' ? account : account?.address;
  if (!accountAddress) throw new Error('Connect your wallet before authorizing payment');
  const existingResponse = await fetch(`/api/executions/by-key?key=${encodeURIComponent(quote.idempotencyKey)}`);
  if (existingResponse.ok) {
    const recovered = await recoverPaidExecution(quote);
    if (recovered.execution.status !== 'COMPLETED') throw new Error(recovered.execution.error ?? `Execution is ${recovered.execution.status}. Do not authorize another payment.`);
    options?.onStatus?.('Completed');
    return recovered;
  }
  if (existingResponse.status !== 404) throw new Error('Sign in with this wallet before authorizing payment');
  const previous = pendingPayments(accountAddress).find(entry => entry.service === quote.service && stableInput(entry.input) === stableInput(quote.input) && entry.workflowStepId === quote.workflowStepId && entry.idempotencyKey !== quote.idempotencyKey);
  if (previous) throw new Error(`A previous purchase needs recovery (${previous.idempotencyKey}). Use payment history before authorizing another payment.`);
  options?.onStatus?.('Awaiting Authorization');
  const signer: ClientEvmSigner = {
    address: accountAddress,
    signTypedData: async message => {
      if (Number(message.domain.chainId) !== BASE_CONFIG.chainId || String(message.domain.verifyingContract).toLowerCase() !== BASE_CONFIG.usdcAddress.toLowerCase() || message.primaryType !== 'TransferWithAuthorization') throw new Error('Wallet authorization domain does not match official USDC');
      if (String(message.message.to).toLowerCase() !== quote.recipient.toLowerCase() || BigInt(String(message.message.value)) !== BigInt(quote.amountUnits)) throw new Error('Wallet authorization terms changed');
      return walletClient.signTypedData({ ...message, account } as Parameters<WalletClient['signTypedData']>[0]);
    },
  };
  const client = x402Client.fromConfig({
    schemes: [{ network: BASE_CONFIG.network, client: new ExactEvmScheme(signer) }],
    spendControls: { maxAmountPerPayment: '$1' },
    policies: [(_version, accepts) => accepts.filter(accepted => accepted.network === quote.network && accepted.asset.toLowerCase() === BASE_CONFIG.usdcAddress.toLowerCase() && accepted.payTo.toLowerCase() === quote.recipient.toLowerCase() && accepted.amount === quote.amountUnits)],
  });
  const payload = await client.createPaymentPayload(quote.paymentRequired);
  assertMatchesRequirements(payload, terms);
  savePending({ service: quote.service, input: quote.input, idempotencyKey: quote.idempotencyKey, workflowStepId: quote.workflowStepId, buyerAddress: accountAddress });
  options?.onStatus?.('Payment Submitted');
  let response: Response;
  try {
    response = await fetch(`/api/services/${quote.service}`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Idempotency-Key': quote.idempotencyKey,
      'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload),
    }, body: requestBody(quote) });
  } catch {
    throw new Error(`Response was lost. Recover request ${quote.idempotencyKey} from payment history before authorizing another payment.`);
  }
  const data = await response.json();
  if (response.status === 202) {
    options?.onStatus?.('Awaiting settlement reconciliation');
    throw new Error(data.execution?.error ?? 'Settlement is pending. Recover this execution before authorizing another payment.');
  }
  if (data.execution?.status === 'FAILED') clearPending(quote.idempotencyKey);
  if (!response.ok) throw new Error(errorMessage(data, data.execution?.error ?? `Payment or execution failed (${response.status})`));
  const result = data as PaidResult;
  if (result.payment?.status !== 'SETTLED' || result.execution?.status !== 'COMPLETED') throw new Error('Server has not confirmed a settled, completed execution');
  clearPending(quote.idempotencyKey);
  options?.onStatus?.('Completed');
  return result;
}
