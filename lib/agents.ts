import type { Prisma } from '@prisma/client';
import { db, jsonSafe } from './db';

export const agentInclude = { _count: { select: { executions: { where: { status: 'COMPLETED' } } } } } satisfies Prisma.AgentInclude;
type IncludedAgent = Prisma.AgentGetPayload<{ include: typeof agentInclude }>;
export function agentDto(agent: IncludedAgent, owner = false) {
  const { ownershipToken, _count, ...rest } = agent;
  return jsonSafe({ ...rest, ...(owner ? { ownershipToken } : {}), executionCount: _count.executions, paymentReady: agent.kind !== 'external' && /^0x[0-9a-fA-F]{40}$/.test(agent.recipient) && agent.status === 'ACTIVE' });
}

export async function getPublicAgents() {
  return (await db.agent.findMany({ where: { status: 'ACTIVE' }, include: agentInclude, orderBy: { createdAt: 'asc' } })).map(a => agentDto(a));
}
