import type { Prisma } from '@prisma/client';
import { ApiError } from './api';
import { validateServiceInput, type ServiceKind } from './services';

export const workflowInclude = { steps: { orderBy: { position: 'asc' as const }, include: { agent: true, execution: { include: { payment: true } } } } };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}

export function resolveStepInput(kind: ServiceKind, template: unknown, inputMode: string, previousOutput?: unknown) {
  if (inputMode === 'STATIC') return validateServiceInput(kind, template);
  if (previousOutput === undefined || previousOutput === null) throw new ApiError(409, 'Complete the previous paid step before resolving this input');
  const base = template as Record<string, unknown>;
  const previous = previousOutput as Record<string, unknown>;
  if (inputMode === 'PREVIOUS_TEXT' && (kind === 'summary' || kind === 'extraction')) {
    const text = typeof previous.summary === 'string' ? previous.summary : JSON.stringify(previousOutput);
    return validateServiceInput(kind, { ...base, text });
  }
  if (inputMode === 'PREVIOUS_NUMBERS' && kind === 'analysis') {
    const values = previous.data && typeof previous.data === 'object' ? Object.values(previous.data as Record<string, unknown>) : [];
    const data = values.find(v => Array.isArray(v) && v.length > 0 && v.every(n => typeof n === 'number' && Number.isFinite(n)));
    if (!data) throw new ApiError(409, 'Previous extraction has no nonempty numeric dataset. This step will not be charged.');
    return validateServiceInput(kind, { data });
  }
  throw new ApiError(400, 'Input transform is not supported for this service');
}

export async function getResolvedWorkflowInput(tx: Prisma.TransactionClient, stepId: string) {
  const step = await tx.workflowStep.findUniqueOrThrow({ where: { id: stepId }, include: { agent: true } });
  const previous = step.position > 0 ? await tx.workflowStep.findUnique({ where: { workflowId_position: { workflowId: step.workflowId, position: step.position - 1 } }, include: { execution: true } }) : null;
  const output = previous?.status === 'COMPLETED' ? previous.execution?.output : undefined;
  return resolveStepInput(step.agent.kind as ServiceKind, step.input, step.inputMode, output);
}

export function workflowDto<T extends { steps: Array<{ input: unknown; inputMode: string; agent: { kind: string }; execution?: { output: unknown } | null; status: string }> }>(workflow: T) {
  return { ...workflow, steps: workflow.steps.map((step, index) => {
    try {
      const previous = workflow.steps[index - 1];
      return { ...step, resolvedInput: resolveStepInput(step.agent.kind as ServiceKind, step.input, step.inputMode, previous?.status === 'COMPLETED' ? previous.execution?.output : undefined), inputError: null };
    } catch (error) { return { ...step, resolvedInput: null, inputError: error instanceof Error ? error.message : 'Input unavailable' }; }
  }) };
}

type Reservation = { userId: string; workflowStepId: string; service: string; amountUnits: bigint; executionId: string };

/** Called inside the payment claim transaction. Serializes all approvals for a chain. */
export async function reserveWorkflowPayment(tx: Prisma.TransactionClient, input: Reservation) {
  const initial = await tx.workflowStep.findUnique({ where: { id: input.workflowStepId }, select: { workflowId: true } });
  if (!initial) throw new ApiError(404, 'Workflow step not found');
  await tx.$queryRaw`SELECT id FROM "Workflow" WHERE id = ${initial.workflowId} FOR UPDATE`;
  const step = await tx.workflowStep.findUnique({ where: { id: input.workflowStepId }, include: { agent: true, execution: true, workflow: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  if (!step || step.workflow.userId !== input.userId) throw new ApiError(403, 'Workflow access denied');
  const workflow = step.workflow;
  if (workflow.status !== 'APPROVED' && workflow.status !== 'RUNNING') throw new ApiError(409, 'Workflow is not approved for execution');
  if (workflow.expiresAt.getTime() <= Date.now()) throw new ApiError(409, 'Workflow approval expired');
  if (step.status !== 'PENDING' || step.execution) throw new ApiError(409, 'Each approved step can execute only once');
  if (step.agent.kind !== input.service || step.agent.status !== 'ACTIVE' || step.agent.kind === 'external') throw new ApiError(403, 'Service is not approved for this step');
  const execution = await tx.execution.findUniqueOrThrow({ where: { id: input.executionId } });
  if (execution.userId !== input.userId || canonical(validateServiceInput(input.service as ServiceKind, execution.input)) !== canonical(await getResolvedWorkflowInput(tx, step.id))) throw new ApiError(403, 'Execution input differs from the approved workflow input');
  if (!(workflow.approvedProviders as string[]).includes(step.agent.recipient)) throw new ApiError(403, 'Provider is not approved for this workflow');
  if (input.amountUnits > step.capUnits || input.amountUnits !== step.agent.priceUnits) throw new ApiError(409, 'Service price exceeds approved cap or has changed');
  if (workflow.spentUnits + workflow.reservedUnits + input.amountUnits > workflow.budgetUnits) throw new ApiError(409, 'Workflow budget exceeded');
  if (workflow.steps.length > workflow.maxExecutions || workflow.steps.length > 3) throw new ApiError(409, 'Execution limit exceeded');
  if (workflow.steps.some(s => s.position < step.position && s.status !== 'COMPLETED')) throw new ApiError(409, 'Complete preceding steps first');
  await tx.workflow.update({ where: { id: workflow.id }, data: { status: 'RUNNING', reservedUnits: { increment: input.amountUnits } } });
  await tx.workflowStep.update({ where: { id: step.id }, data: { status: 'RESERVED', reservedAmountUnits: input.amountUnits } });
  await tx.execution.update({ where: { id: input.executionId }, data: { workflowId: workflow.id, workflowStepId: step.id } });
}

type FinalizePhase = 'SETTLED' | 'COMPLETED' | 'FAILED_UNSETTLED' | 'FAILED_SETTLED';
export async function finalizeWorkflowPayment(tx: Prisma.TransactionClient, executionId: string, phase: FinalizePhase) {
  const execution = await tx.execution.findUnique({ where: { id: executionId }, include: { workflowStep: true } });
  if (!execution?.workflowStep) return;
  const step = execution.workflowStep;
  await tx.$queryRaw`SELECT id FROM "Workflow" WHERE id = ${step.workflowId} FOR UPDATE`;
  const current = await tx.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
  const price = step.reservedAmountUnits;
  if ((phase === 'SETTLED' || phase === 'COMPLETED' || phase === 'FAILED_SETTLED') && current.status === 'RESERVED') {
    await tx.workflow.update({ where: { id: step.workflowId }, data: { reservedUnits: { decrement: price }, spentUnits: { increment: price } } });
  }
  if (phase === 'FAILED_UNSETTLED' && current.status === 'RESERVED') {
    await tx.workflow.update({ where: { id: step.workflowId }, data: { reservedUnits: { decrement: price }, status: 'FAILED' } });
  }
  if (phase === 'SETTLED') {
    if (current.status === 'RESERVED') await tx.workflowStep.update({ where: { id: step.id }, data: { status: 'SETTLED' } });
    return;
  }
  if (phase === 'COMPLETED') {
    await tx.workflowStep.update({ where: { id: step.id }, data: { status: 'COMPLETED' } });
    const remaining = await tx.workflowStep.count({ where: { workflowId: step.workflowId, status: { not: 'COMPLETED' } } });
    if (remaining === 0) await tx.workflow.update({ where: { id: step.workflowId }, data: { status: 'COMPLETED' } });
  } else {
    await tx.workflowStep.update({ where: { id: step.id }, data: { status: 'FAILED' } });
    await tx.workflow.update({ where: { id: step.workflowId }, data: { status: 'FAILED' } });
  }
}
