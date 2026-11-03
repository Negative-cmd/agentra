import { z } from 'zod';
import { apiError, ApiError, readJson, respond } from '@/lib/api';
import { requireAdmin, requireSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { assertApprovedHost } from '@/lib/validation';

export async function GET() {
  try {
    await requireAdmin();
    const [agents, audits, users, providers, executions, settlements] = await Promise.all([
      db.agent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }), db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }), db.user.count(), db.providerProfile.count(), db.execution.count(), db.paymentTransaction.count({ where: { status: 'SETTLED' } }),
    ]);
    return respond({ agents, audits, metrics: { users, providers, executions, settlements } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const admin = await requireAdmin();
    const input = z.object({ agentId: z.string(), action: z.enum(['disable', 'approve']), ownershipEvidence: z.string().max(3000).optional(), contractEvidence: z.string().max(3000).optional() }).strict().parse(await readJson(request));
    const agent = await db.agent.findUnique({ where: { id: input.agentId } });
    if (!agent) throw new ApiError(404, 'Agent not found');
    if (input.action === 'approve') {
      if (agent.kind !== 'external') throw new ApiError(400, 'Reference services do not require provider review');
      assertApprovedHost(agent.endpointUrl);
      if (!input.ownershipEvidence || input.ownershipEvidence.length < 20 || !input.contractEvidence || input.contractEvidence.length < 20) throw new ApiError(400, 'Document independently verified ownership and request/response contract evidence before approval');
    }
    const updated = await db.$transaction(async tx => {
      const updated = await tx.agent.update({ where: { id: agent.id }, data: input.action === 'disable' ? { status: 'DISABLED' } : { status: 'ACTIVE', ownershipVerifiedAt: new Date(), contractVerifiedAt: new Date(), endpoint: { update: { approvedHost: new URL(agent.endpointUrl).hostname, verifiedAt: new Date() } } } });
      await tx.auditLog.create({ data: { userId: admin.id, action: input.action === 'approve' ? 'AGENT_APPROVED_MANUALLY' : 'AGENT_DISABLED', target: agent.id, detail: { ownershipEvidence: input.ownershipEvidence ?? null, contractEvidence: input.contractEvidence ?? null } } });
      return updated;
    });
    return respond({ agent: updated });
  } catch (error) { return apiError(error); }
}
