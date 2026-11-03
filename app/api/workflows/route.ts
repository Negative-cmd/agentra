import { apiError, ApiError, readJson, respond, rateLimit } from '@/lib/api';
import { requireSameOrigin, requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { validateServiceInput, type ServiceKind } from '@/lib/services';
import { workflowSchema, usdcToUnits } from '@/lib/validation';
import { workflowDto, workflowInclude } from '@/lib/workflows';

export async function GET() {
  try { const user = await requireUser(); return respond({ workflows: (await db.workflow.findMany({ where: { userId: user.id }, include: workflowInclude, orderBy: { createdAt: 'desc' }, take: 100 })).map(workflowDto) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const user = await requireUser(); rateLimit(`workflows:${user.id}`, 20);
    const input = workflowSchema.parse(await readJson(request));
    const budgetUnits = usdcToUnits(input.budgetUsdc);
    const agents = await db.agent.findMany({ where: { id: { in: input.steps.map(s => s.agentId) }, status: 'ACTIVE', kind: { in: ['summary', 'analysis', 'extraction'] } } });
    const steps = input.steps.map((s, position) => {
      const agent = agents.find(a => a.id === s.agentId);
      if (!agent) throw new ApiError(400, 'Only active reference services can be used in Agent Chains');
      const capUnits = usdcToUnits(s.capUsdc);
      if (agent.priceUnits > capUnits) throw new ApiError(400, 'Per-service spending cap is below its price');
      if (position === 0 && s.inputMode !== 'STATIC') throw new ApiError(400, 'The first step needs explicit input');
      if (s.inputMode === 'PREVIOUS_TEXT' && !['summary', 'extraction'].includes(agent.kind)) throw new ApiError(400, 'Previous-text input is supported only for summary and extraction');
      if (s.inputMode === 'PREVIOUS_NUMBERS' && agent.kind !== 'analysis') throw new ApiError(400, 'Previous-numbers input is supported only for analysis');
      validateServiceInput(agent.kind as ServiceKind, s.inputMode === 'PREVIOUS_TEXT' ? { ...s.input, text: 'Approved previous output will supply this text.' } : s.inputMode === 'PREVIOUS_NUMBERS' ? { ...s.input, data: [0] } : s.input);
      return { agentId: agent.id, position, capUnits, input: s.input as never, inputMode: s.inputMode };
    });
    if (steps.reduce((sum, s) => sum + s.capUnits, 0n) > budgetUnits || budgetUnits <= 0n) throw new ApiError(400, 'Total service caps exceed the approved budget');
    const workflow = await db.$transaction(async tx => {
      const workflow = await tx.workflow.create({ data: { userId: user.id, name: input.name, budgetUnits, expiresAt: new Date(Date.now() + 3_600_000), maxExecutions: steps.length, approvedProviders: [...new Set(agents.map(a => a.recipient))], steps: { create: steps } }, include: workflowInclude });
      await tx.auditLog.create({ data: { userId: user.id, action: 'WORKFLOW_APPROVED', target: workflow.id, detail: { budgetUnits: budgetUnits.toString(), services: steps.map(s => ({ agentId: s.agentId, inputMode: s.inputMode })), policy: 'Each payment still requires wallet approval. Only fixed approved input transforms can pass output to the next step.' } } });
      return workflow;
    });
    return respond({ workflow: workflowDto(workflow) }, 201);
  } catch (error) { return apiError(error); }
}
