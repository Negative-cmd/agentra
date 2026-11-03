/** Optional REAL PostgreSQL route/state integration. Facilitator + RPC evidence are
 * explicit mocks: these tests NEVER broadcast or claim a real settlement.
 * Run: RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/payments-db.test.ts
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload } from '@x402/core/types';
import { db } from '@/lib/db';
import { POST } from '@/app/api/services/[service]/route';
import { authOrigin } from '@/lib/auth';
import { createPaymentChallenge, createPaymentRequirement } from '@/lib/payments/server';

const state = vi.hoisted(() => ({
  user: { id: '', address: '0x1111111111111111111111111111111111111111', role: 'USER' },
  verify: vi.fn(), settle: vi.fn(), evidence: vi.fn(),
}));
vi.mock('@/lib/auth', async importActual => ({ ...(await importActual<Record<string, unknown>>()), requireUser: async () => state.user }));
vi.mock('@/lib/payments/server', async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  getPaymentServer: async () => ({ verifyPayment: state.verify, settlePayment: state.settle }),
  verifySettlementEvidence: state.evidence,
}));
const runDb = process.env.RUN_DB_TESTS === '1';
const suite = describe.skipIf(!runDb);
const input = { text: 'Agentra provides useful services. USDC payments are authorized individually.' };
let terms: Awaited<ReturnType<typeof createPaymentRequirement>>;
let challenge: Awaited<ReturnType<typeof createPaymentChallenge>>;
const key = () => `payment-test-${randomBytes(16).toString('hex')}`;
function payload(): PaymentPayload {
  return { x402Version: 2, resource: challenge.resource, accepted: terms, extensions: challenge.extensions,
    payload: { signature: '0x' + 'ab'.repeat(65), authorization: { from: state.user.address, to: terms.payTo, value: terms.amount,
      validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: '0x' + randomBytes(32).toString('hex') } } };
}
function request(idempotencyKey: string, proof?: PaymentPayload, textInput = input) {
  return new Request(`${authOrigin()}/api/services/summary`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: authOrigin(), 'Idempotency-Key': idempotencyKey,
    ...(proof ? { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(proof) } : {}),
  }, body: JSON.stringify({ input: textInput }) });
}
const post = (req: Request) => POST(req, { params: Promise.resolve({ service: 'summary' }) });

suite('paid endpoint state machine with PostgreSQL (mock facilitator/RPC)', () => {
  beforeAll(async () => {
    state.user.address = '0x' + randomBytes(20).toString('hex');
    const user = await db.user.create({ data: { address: state.user.address } });
    state.user.id = user.id;
    const agent = await db.agent.findUniqueOrThrow({ where: { id: 'summary' } });
    terms = await createPaymentRequirement(agent.priceUnits);
    challenge = await createPaymentChallenge(terms, `${authOrigin()}/api/services/summary`, agent.description);
  });
  beforeEach(() => {
    state.verify.mockReset().mockResolvedValue({ isValid: true, payer: state.user.address });
    state.settle.mockReset().mockImplementation(async () => ({ success: true, network: terms.network, transaction: '0x' + randomBytes(32).toString('hex'), payer: state.user.address }));
    state.evidence.mockReset().mockResolvedValue({ blockNumber: '1', attribution: { status: 'not-confirmed', appCode: null } });
  });
  afterAll(async () => {
    if (!state.user.id) return;
    await db.providerEarning.deleteMany({ where: { payment: { execution: { userId: state.user.id } } } });
    await db.executionStep.deleteMany({ where: { execution: { userId: state.user.id } } });
    await db.paymentTransaction.deleteMany({ where: { execution: { userId: state.user.id } } });
    await db.execution.deleteMany({ where: { userId: state.user.id } });
    await db.auditLog.deleteMany({ where: { userId: state.user.id } });
    await db.user.delete({ where: { id: state.user.id } });
    await db.$disconnect();
  });
  it('returns real SDK 402 terms without running or settling', async () => {
    const response = await post(request(key()));
    expect(response.status).toBe(402);
    expect(response.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    expect(state.settle).not.toHaveBeenCalled();
    expect(await db.execution.count({ where: { userId: state.user.id } })).toBe(0);
  });
  it('rejects proof from a wallet different from the session before settlement', async () => {
    const proof = payload(); (proof.payload.authorization as Record<string, unknown>).from = terms.payTo;
    expect((await post(request(key(), proof))).status).toBe(400);
    expect(state.settle).not.toHaveBeenCalled();
  });
  it('rejects facilitator-invalid proof without creating paid work', async () => {
    state.verify.mockResolvedValueOnce({ isValid: false, invalidReason: 'invalid_signature' });
    expect((await post(request(key(), payload()))).status).toBe(402);
    expect(state.settle).not.toHaveBeenCalled();
  });
  it('settles once then safely recovers identical result and rejects changed input', async () => {
    const idempotencyKey = key(); const proof = payload();
    const response = await post(request(idempotencyKey, proof)); const data = await response.json();
    expect(response.status).toBe(200); expect(data.execution.status).toBe('COMPLETED');
    expect(data.payment.status).toBe('SETTLED'); expect(data.result.mode).toBe('deterministic-reference');
    expect(response.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
    const recovered = await post(request(idempotencyKey));
    expect(recovered.status).toBe(200); expect((await recovered.json()).payment.txHash).toBe(data.payment.txHash);
    expect(state.settle).toHaveBeenCalledTimes(1);
    expect((await post(request(idempotencyKey, undefined, { text: 'Different task.' }))).status).toBe(409);
    expect((await post(request(key(), proof))).status).toBe(409);
    expect(state.settle).toHaveBeenCalledTimes(1);
  });
  it('retains ambiguous settlement, returns no work and never resubmits on recovery', async () => {
    const idempotencyKey = key(); state.settle.mockRejectedValueOnce(new Error('response lost'));
    const response = await post(request(idempotencyKey, payload())); const data = await response.json();
    expect(response.status).toBe(202); expect(data.execution.status).toBe('SETTLEMENT_UNKNOWN'); expect(data.result).toBeNull();
    expect((await post(request(idempotencyKey))).status).toBe(202);
    expect(state.settle).toHaveBeenCalledTimes(1);
  });
  it('cannot run a service before independent evidence is verified', async () => {
    const idempotencyKey = key(); state.evidence.mockRejectedValueOnce(new Error('unverified nonce'));
    const response = await post(request(idempotencyKey, payload())); const data = await response.json();
    expect(response.status).toBe(202); expect(data.result).toBeNull(); expect(data.payment.status).toBe('SUBMITTED');
    expect((await post(request(idempotencyKey))).status).toBe(200);
    expect(state.settle).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent original/recovery finalization without downgrading completion or duplicating earnings', async () => {
    const idempotencyKey = key(); let release: () => void = () => {}; let evidenceReached: () => void = () => {};
    const reached = new Promise<void>(resolve => { evidenceReached = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    state.evidence.mockImplementationOnce(async () => { evidenceReached(); await barrier; return { blockNumber: '1' }; });
    const original = post(request(idempotencyKey, payload())); await reached;
    const recovered = await post(request(idempotencyKey)); expect(recovered.status).toBe(200);
    release(); const first = await original; expect(first.status).toBe(200);
    const execution = await db.execution.findUniqueOrThrow({ where: { idempotencyKey }, include: { payment: { include: { earning: true } } } });
    expect(execution.status).toBe('COMPLETED'); expect(execution.payment?.status).toBe('SETTLED'); expect(execution.payment?.earning).toBeTruthy();
    expect(state.settle).toHaveBeenCalledTimes(1);
  });
});
