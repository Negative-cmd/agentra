import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { deepEqual } from '@x402/core/utils';
import { z } from 'zod';
import { BASE_CONFIG } from '@/lib/chain';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const integer = z.string().regex(/^\d+$/);
export const eip3009PayloadSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(16_384),
  authorization: z.object({
    from: address, to: address, value: integer,
    validAfter: integer, validBefore: integer,
    nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }).strict(),
}).strict();

/** Compare every advertised term, including token/domain/flow metadata. */
export function assertMatchesRequirements(payload: PaymentPayload, requirement: PaymentRequirements) {
  if (payload.x402Version !== 2 || !deepEqual(payload.accepted, requirement)) {
    throw new Error('Payment terms changed. Request and review a fresh quote.');
  }
  if (requirement.scheme !== 'exact' || requirement.network !== BASE_CONFIG.network || requirement.asset.toLowerCase() !== BASE_CONFIG.usdcAddress.toLowerCase()) {
    throw new Error('Only official USDC on the configured Base network is supported.');
  }
  const payment = eip3009PayloadSchema.parse(payload.payload);
  if (payment.authorization.to.toLowerCase() !== requirement.payTo.toLowerCase() || BigInt(payment.authorization.value) !== BigInt(requirement.amount)) {
    throw new Error('Signed recipient or amount does not match the quote.');
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(payment.authorization.validBefore) <= now || BigInt(payment.authorization.validAfter) > now) {
    throw new Error('Payment authorization is expired or not yet active.');
  }
  return payment;
}

/** Fingerprint the onchain nonce, not the mutable envelope or signature bytes. */
export function authorizationIdentity(payload: PaymentPayload): string {
  const { authorization } = eip3009PayloadSchema.parse(payload.payload);
  return [payload.accepted.network, payload.accepted.asset.toLowerCase(), authorization.from.toLowerCase(), authorization.nonce.toLowerCase()].join(':');
}
