import { z } from 'zod';
import { apiError, ApiError, readJson, respond } from '@/lib/api';
import { requireSameOrigin, requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { workflowDto, workflowInclude } from '@/lib/workflows';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await context.params;
    const workflow = await db.workflow.findUnique({ where: { id }, include: workflowInclude });
    if (!workflow || workflow.userId !== user.id) throw new ApiError(404, 'Workflow not found');
    return respond({ workflow: workflowDto(workflow) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request); const user = await requireUser(); const { id } = await context.params;
    z.object({ action: z.literal('cancel') }).strict().parse(await readJson(request));
    const workflow = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Workflow" WHERE id = ${id} FOR UPDATE`;
      const workflow = await tx.workflow.findUnique({ where: { id } });
      if (!workflow || workflow.userId !== user.id) throw new ApiError(404, 'Workflow not found');
      if (workflow.reservedUnits > 0n) throw new ApiError(409, 'A payment is in progress. Wait for reconciliation before cancelling.');
      if (!['APPROVED', 'RUNNING'].includes(workflow.status)) throw new ApiError(409, 'Workflow can no longer be cancelled');
      const updated = await tx.workflow.update({ where: { id }, data: { status: 'CANCELLED' }, include: workflowInclude });
      await tx.auditLog.create({ data: { userId: user.id, action: 'WORKFLOW_CANCELLED', target: id } });
      return updated;
    });
    return respond({ workflow: workflowDto(workflow) });
  } catch (error) { return apiError(error); }
}
