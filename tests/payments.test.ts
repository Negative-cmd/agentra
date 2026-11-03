import { afterEach, describe, expect, it, vi } from 'vitest';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { encodePaymentRequiredHeader, decodePaymentRequiredHeader, encodePaymentSignatureHeader, decodePaymentSignatureHeader } from '@x402/core/http';
import { encodeBuilderCodeSuffix, parseBuilderCodeSuffixFromCalldata } from '@x402/extensions/builder-code';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { BASE_CONFIG, BUILDER_CODE, SUPPLIED_ATTRIBUTION_REFERENCE } from '@/lib/chain';
import { assertMatchesRequirements, authorizationIdentity } from '@/lib/payments/policy';
import { createPaymentChallenge, createPaymentRequirement, paymentConfiguration } from '@/lib/payments/server';

vi.mock('@/lib/db', () => ({ db: {}, jsonSafe: (value: unknown) => value }));
const buyer = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const requirement: PaymentRequirements = { scheme: 'exact', network: BASE_CONFIG.network, amount: '1000', asset: BASE_CONFIG.usdcAddress, payTo: recipient, maxTimeoutSeconds: 300, extra: { name: BASE_CONFIG.usdcName, version: '2' } };
const makePayload = (): PaymentPayload => ({ x402Version: 2, resource: { url: 'https://agentra.example/api/services/summary' }, accepted: structuredClone(requirement), payload: {
  signature: '0x' + 'ab'.repeat(65), authorization: { from: buyer, to: recipient, value: '1000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: '0x' + '01'.repeat(32) },
} });
afterEach(() => vi.unstubAllEnvs());

describe('exact Base USDC authorization policy', () => {
  it('defaults to Base Sepolia and official USDC', () => {
    expect(BASE_CONFIG.chainId).toBe(84532);
    expect(BASE_CONFIG.usdcAddress).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });
  it('accepts matching, bounded, current authorizations', () => expect(assertMatchesRequirements(makePayload(), requirement).authorization.value).toBe('1000'));
  it.each(['amount', 'asset', 'payTo', 'network', 'maxTimeoutSeconds', 'extra', 'scheme'] as const)('rejects altered advertised %s', field => {
    const payload = makePayload();
    (payload.accepted as unknown as Record<string, unknown>)[field] = field === 'extra' ? { name: 'Impostor' } : field === 'maxTimeoutSeconds' ? 600 : 'changed';
    expect(() => assertMatchesRequirements(payload, requirement)).toThrow();
  });
  it('rejects a signed recipient different from the offer', () => {
    const payload = makePayload(); (payload.payload.authorization as Record<string, unknown>).to = buyer;
    expect(() => assertMatchesRequirements(payload, requirement)).toThrow(/recipient/);
  });
  it('rejects a signed amount different from the offer', () => {
    const payload = makePayload(); (payload.payload.authorization as Record<string, unknown>).value = '1001';
    expect(() => assertMatchesRequirements(payload, requirement)).toThrow(/amount/);
  });
  it('rejects expired authorization', () => {
    const payload = makePayload(); (payload.payload.authorization as Record<string, unknown>).validBefore = '1';
    expect(() => assertMatchesRequirements(payload, requirement)).toThrow(/expired/);
  });
  it('rejects not-yet-valid authorization', () => {
    const payload = makePayload(); (payload.payload.authorization as Record<string, unknown>).validAfter = String(Math.floor(Date.now() / 1000) + 100);
    expect(() => assertMatchesRequirements(payload, requirement)).toThrow(/not yet/);
  });
  it('fingerprints the onchain nonce regardless of envelope/signature modification', () => {
    const first = makePayload(); const second = makePayload();
    second.payload.signature = '0x' + 'cd'.repeat(65);
    second.extensions = { arbitrary: { modified: true } };
    expect(authorizationIdentity(first)).toBe(authorizationIdentity(second));
  });
  it('distinguishes new authorization nonces', () => {
    const first = makePayload(); const second = makePayload();
    (second.payload.authorization as Record<string, unknown>).nonce = '0x' + '02'.repeat(32);
    expect(authorizationIdentity(first)).not.toBe(authorizationIdentity(second));
  });
  it('roundtrips official v2 PAYMENT-SIGNATURE headers', () => {
    const payload = makePayload(); expect(decodePaymentSignatureHeader(encodePaymentSignatureHeader(payload))).toEqual(payload);
  });
});

describe('configuration and SDK-produced offers', () => {
  it('disables payments without an actual provider recipient', () => {
    vi.stubEnv('PAYMENT_RECIPIENT', ''); expect(paymentConfiguration().enabled).toBe(false);
  });
  it.each(['invalid', '0x0000000000000000000000000000000000000000'])('rejects invalid recipient %s', value => {
    vi.stubEnv('PAYMENT_RECIPIENT', value); expect(paymentConfiguration().enabled).toBe(false);
  });
  it('builds an exact integer-unit offer using the official EVM SDK and header codec', async () => {
    vi.stubEnv('PAYMENT_RECIPIENT', recipient);
    const offer = await createPaymentRequirement(1000n);
    expect(offer).toEqual(requirement);
    const challenge = await createPaymentChallenge(offer, 'https://agentra.example/api/services/summary', 'Summary');
    expect(challenge.x402Version).toBe(2);
    expect(decodePaymentRequiredHeader(encodePaymentRequiredHeader(challenge))).toEqual(challenge);
    expect(challenge.extensions?.['builder-code']).toMatchObject({ info: { a: BUILDER_CODE } });
  });
  it.each([0n, -1n, 1_000_001n])('refuses unsafe reference price %s', async units => {
    vi.stubEnv('PAYMENT_RECIPIENT', recipient); await expect(createPaymentRequirement(units)).rejects.toThrow();
  });
  it('signs only the reviewed official USDC EIP-3009 terms using the SDK (local key, no network or spending)', async () => {
    vi.stubEnv('PAYMENT_RECIPIENT', recipient);
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = { address: account.address, signTypedData: vi.fn(account.signTypedData) };
    const client = new x402Client().register(BASE_CONFIG.network, new ExactEvmScheme(signer));
    const offer = await createPaymentRequirement(1000n);
    const challenge = await createPaymentChallenge(offer, 'https://agentra.example/api/services/summary', 'Summary');
    const payload = await client.createPaymentPayload(challenge);
    expect(signer.signTypedData).toHaveBeenCalledOnce();
    expect(assertMatchesRequirements(payload, offer).authorization.from).toBe(account.address);
    expect(payload.extensions?.['builder-code']).toMatchObject({ info: { a: BUILDER_CODE } });
  });
});

describe('builder code attribution encoding', () => {
  it('preserves the supplied code and schema-0 reference exactly', () => {
    expect(BUILDER_CODE).toBe('bc_lvlczcjt');
    expect(SUPPLIED_ATTRIBUTION_REFERENCE).toBe('0x62635f6c766c637a636a740b0080218021802180218021802180218021');
    expect(SUPPLIED_ATTRIBUTION_REFERENCE.slice(-34, -32)).toBe('00');
  });
  it('uses current SDK Schema 2 CBOR encoding for x402, distinct from the supplied reference', () => {
    const suffix = encodeBuilderCodeSuffix({ a: BUILDER_CODE });
    expect(suffix).not.toBe(SUPPLIED_ATTRIBUTION_REFERENCE);
    expect(parseBuilderCodeSuffixFromCalldata(('0x1234' + suffix.slice(2)) as `0x${string}`)?.a).toBe(BUILDER_CODE);
    expect(suffix.slice(-34, -32)).toBe('02');
  });
});
