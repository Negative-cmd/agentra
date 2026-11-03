import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentPayload, SettleResponse } from '@x402/core/types';
import { PaymentPayloadSchema } from '@x402/core/schemas';
import { z } from 'zod';
import { apiError, ApiError, readJson, rateLimit, requestIp } from '@/lib/api';
import { authOrigin, requireSameOrigin, requireUser } from '@/lib/auth';
import { db, jsonSafe } from '@/lib/db';
import { serviceKinds, executeService, validateServiceInput, type ServiceKind } from '@/lib/services';
import { BASE_CONFIG } from '@/lib/chain';
import { assertMatchesRequirements, authorizationIdentity } from '@/lib/payments/policy';
import { createPaymentChallenge, createPaymentRequirement, getPaymentServer, paymentExtensions, verifySettlementEvidence } from '@/lib/payments/server';
import { finalizeWorkflowPayment, reserveWorkflowPayment } from '@/lib/workflows';

export const runtime = 'nodejs';
export const maxDuration = 120;
const requestSchema = z.object({ input: z.unknown(), workflowStepId: z.string().min(1).max(100).optional() }).strict();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}

async function executionResponse(id: string) {
  const execution = await db.execution.findUniqueOrThrow({ where: { id }, include: { payment: true } });
  const settled = execution.payment?.status === 'SETTLED';
  const receipt = settled ? execution.payment?.receipt as unknown as SettleResponse : null;
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (receipt?.success) headers['PAYMENT-RESPONSE'] = encodePaymentResponseHeader(receipt);
  return NextResponse.json(jsonSafe({ execution, result: execution.output, payment: execution.payment }), {
    status: execution.status === 'COMPLETED' ? 200 : execution.status === 'FAILED' ? 422 : 202, headers,
  });
}

async function completeExecution(id: string, kind: ServiceKind, input: unknown) {
  const current = await db.execution.findUniqueOrThrow({ where: { id } });
  if (current.status === 'COMPLETED' || current.status === 'FAILED') return executionResponse(id);
  // Reference implementations are pure and deterministic. Re-running after a crash
  // produces the same output without another payment or external side effect.
  const claimed = await db.execution.updateMany({ where: { id, OR: [{ status: 'SETTLED' }, { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 30_000) } }] }, data: { status: 'RUNNING' } });
  if (!claimed.count) return executionResponse(id);
  try {
    const result = executeService(kind, input);
    await db.$transaction(async tx => {
      await tx.execution.update({ where: { id }, data: { status: 'COMPLETED', output: result as Prisma.InputJsonValue, error: null } });
      await tx.executionStep.create({ data: { executionId: id, status: 'COMPLETED', detail: 'Deterministic reference service completed after verified USDC settlement' } });
      await finalizeWorkflowPayment(tx, id, 'COMPLETED');
    });
  } catch {
    await db.$transaction(async tx => {
      await tx.execution.update({ where: { id }, data: { status: 'FAILED', error: 'Payment settled but service failed. Keep your receipt and contact the provider; refunds are manual.' } });
      await finalizeWorkflowPayment(tx, id, 'FAILED_SETTLED');
    });
  }
  return executionResponse(id);
}

/** Recovery never resubmits a payment. Reconcile a stored real transaction, or
 * stop for manual investigation if its hash was lost during facilitator timeout.
 */
async function recoverExecution(id: string, kind: ServiceKind, input: unknown) {
  const current = await db.execution.findUniqueOrThrow({ where: { id }, include: { payment: true } });
  if (current.status === 'COMPLETED' || current.status === 'FAILED') return executionResponse(id);
  if (current.payment?.status === 'SETTLED') return completeExecution(id, kind, input);
  const storedReceipt = current.payment?.receipt as unknown as SettleResponse | null;
  if (!storedReceipt?.success || !current.payment?.txHash) return executionResponse(id);
  try {
    const evidence = await verifySettlementEvidence(storedReceipt, current.payment.buyer, current.payment.recipient, current.payment.amountUnits, String((storedReceipt as SettleResponse & { authorizationNonce?: string }).authorizationNonce ?? ''));
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Execution" WHERE id = ${id} FOR UPDATE`;
      const locked = await tx.execution.findUniqueOrThrow({ where: { id }, include: { payment: true } });
      if (locked.payment?.status === 'SETTLED') return;
      await tx.paymentTransaction.update({ where: { executionId: id }, data: { status: 'SETTLED', receipt: { ...storedReceipt, evidence } as Prisma.InputJsonValue } });
      await tx.execution.update({ where: { id }, data: { status: 'SETTLED', error: null } });
      const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { executionId: id } });
      await tx.providerEarning.upsert({ where: { paymentId: payment.id }, create: { paymentId: payment.id, recipient: payment.recipient, amountUnits: payment.amountUnits }, update: {} });
      await finalizeWorkflowPayment(tx, id, 'SETTLED');
    });
    return completeExecution(id, kind, input);
  } catch {
    return executionResponse(id);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ service: string }> }) {
  try {
    rateLimit(`paid:${requestIp(request)}`, 40);
    const { service } = await params;
    if (!serviceKinds.includes(service as ServiceKind)) throw new ApiError(404, 'Service not found');
    const kind = service as ServiceKind;
    const body = requestSchema.parse(await readJson(request));
    const input = validateServiceInput(kind, body.input);
    const agent = await db.agent.findUnique({ where: { id: kind } });
    if (!agent || agent.kind !== kind || agent.status !== 'ACTIVE') throw new ApiError(404, 'Service is unavailable');
    const signature = request.headers.get('PAYMENT-SIGNATURE');
    const key = request.headers.get('Idempotency-Key');
    const existing = key ? await db.execution.findUnique({ where: { idempotencyKey: key } }) : null;
    if (existing) {
      requireSameOrigin(request);
      const user = await requireUser();
      const requestHash = digest(canonical({ userId: user.id, kind, input, workflowStepId: body.workflowStepId ?? null }));
      if (existing.userId !== user.id) throw new ApiError(404, 'Execution not found');
      if (existing.requestHash !== requestHash) throw new ApiError(409, 'Idempotency key already belongs to different input');
      return recoverExecution(existing.id, kind, input);
    }
    const requirement = await createPaymentRequirement(agent.priceUnits);
    if (agent.recipient.toLowerCase() !== requirement.payTo.toLowerCase()) throw new ApiError(503, 'Provider recipient configuration changed. Refresh the reference service configuration before accepting payments.');
    const challenge = await createPaymentChallenge(requirement, `${authOrigin()}/api/services/${kind}`, agent.description);
    if (!signature) {
      return NextResponse.json(challenge, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge), 'Cache-Control': 'no-store' } });
    }
    requireSameOrigin(request);
    const user = await requireUser();
    if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new ApiError(400, 'Send a unique Idempotency-Key with 16–100 letters, numbers, underscores, or hyphens');
    if (signature.length > 24_000) throw new ApiError(400, 'Payment header too large');
    let payload: PaymentPayload;
    try {
      payload = PaymentPayloadSchema.parse(decodePaymentSignatureHeader(signature)) as PaymentPayload;
      const validated = assertMatchesRequirements(payload, requirement);
      if (validated.authorization.from.toLowerCase() !== user.address.toLowerCase()) throw new Error('Payment wallet must match the signed-in wallet');
      if (payload.resource?.url !== challenge.resource.url) throw new Error('Payment resource does not match this endpoint');
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'Invalid payment authorization');
    }
    let server;
    try { server = await getPaymentServer(); }
    catch { throw new ApiError(503, 'Payment facilitator is unavailable. No payment has been submitted by this request.'); }
    const verified = await server.verifyPayment(payload, requirement, paymentExtensions);
    if (!verified.isValid || verified.payer?.toLowerCase() !== user.address.toLowerCase()) {
      throw new ApiError(402, verified.invalidMessage ?? verified.invalidReason ?? 'Payment could not be verified for this wallet');
    }
    const payloadHash = digest(authorizationIdentity(payload));
    const requestHash = digest(canonical({ userId: user.id, kind, input, workflowStepId: body.workflowStepId ?? null }));
    let execution;
    try {
      execution = await db.$transaction(async tx => {
        const record = await tx.execution.create({ data: {
          idempotencyKey: key, requestHash, paymentPayloadHash: payloadHash,
          userId: user.id, agentId: agent.id, buyerAddress: user.address,
          input: input as Prisma.InputJsonValue, status: 'SETTLING',
          payment: { create: { buyer: user.address, recipient: requirement.payTo, amountUnits: agent.priceUnits,
            network: BASE_CONFIG.network, status: 'PENDING', payloadHash } },
        } });
        if (body.workflowStepId) await reserveWorkflowPayment(tx, {
          userId: user.id, workflowStepId: body.workflowStepId, service: kind, amountUnits: agent.priceUnits, executionId: record.id,
        });
        await tx.executionStep.create({ data: { executionId: record.id, status: 'SETTLING', detail: 'Authorized proof verified; submitting settlement' } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'PAYMENT_SUBMITTED', target: record.id } });
        return record;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(409, 'This authorization or idempotency key is already claimed. Recover the original execution; do not sign another payment.');
      throw error;
    }
    let settlement: SettleResponse;
    try {
      // This direct core invocation deliberately settles BEFORE fulfillment.
      settlement = await server.settlePayment(payload, requirement, paymentExtensions, undefined, undefined, 'before-handler');
      if (!settlement.success) {
        // A facilitator failure may still be ambiguous. Keep the reservation and
        // prohibit resubmission; an operator reconciles it using the nonce.
        throw new Error('Settlement was not confirmed');
      }
      await db.paymentTransaction.update({ where: { executionId: execution.id }, data: {
        status: 'SUBMITTED', txHash: settlement.transaction || null, receipt: { ...settlement, authorizationNonce: String((payload.payload.authorization as Record<string, unknown>).nonce) } as Prisma.InputJsonValue,
      } });
      const evidence = await verifySettlementEvidence(settlement, user.address, requirement.payTo, agent.priceUnits, String((payload.payload.authorization as Record<string, unknown>).nonce));
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Execution" WHERE id = ${execution.id} FOR UPDATE`;
        const locked = await tx.execution.findUniqueOrThrow({ where: { id: execution.id }, include: { payment: true } });
        if (locked.payment?.status === 'SETTLED') return;
        await tx.paymentTransaction.update({ where: { executionId: execution.id }, data: { status: 'SETTLED', receipt: { ...settlement, authorizationNonce: String((payload.payload.authorization as Record<string, unknown>).nonce), evidence } as Prisma.InputJsonValue } });
        await tx.execution.update({ where: { id: execution.id }, data: { status: 'SETTLED' } });
        const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { executionId: execution.id } });
        await tx.providerEarning.upsert({ where: { paymentId: payment.id }, create: { paymentId: payment.id, recipient: requirement.payTo, amountUnits: agent.priceUnits }, update: {} });
        await tx.executionStep.create({ data: { executionId: execution.id, status: 'SETTLED', detail: 'Confirmed official USDC transfer independently verified on Base' } });
        await finalizeWorkflowPayment(tx, execution.id, 'SETTLED');
      });
    } catch {
      await db.execution.updateMany({ where: { id: execution.id, status: { notIn: ['COMPLETED', 'FAILED', 'SETTLED', 'RUNNING'] } }, data: { status: 'SETTLEMENT_UNKNOWN', error: 'Settlement needs reconciliation. Do not authorize another payment. Retry this same request key to recover a recorded transaction, or contact the provider.' } });
      return executionResponse(execution.id);
    }
    return completeExecution(execution.id, kind, input);
  } catch (error) { return apiError(error); }
}
