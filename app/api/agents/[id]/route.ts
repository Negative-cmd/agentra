import { apiError, ApiError, respond } from '@/lib/api';
import { agentDto, agentInclude } from '@/lib/agents';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const agent = await db.agent.findFirst({ where: { OR: [{ id }, { slug: id }] }, include: agentInclude });
    const user = await currentUser();
    if (!agent || (agent.status !== 'ACTIVE' && user?.id !== agent.ownerId && user?.role !== 'ADMIN')) throw new ApiError(404, 'Agent not found');
    return respond({ agent: agentDto(agent, user?.id === agent.ownerId) });
  } catch (error) { return apiError(error); }
}
