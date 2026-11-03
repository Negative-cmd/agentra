import { apiError, respond } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const user = await requireUser();
    const network = process.env.NEXT_PUBLIC_BASE_NETWORK === 'base' ? 'eip155:8453' : 'eip155:84532';
    const [registeredAgents, activeWorkflows, spending, earnings, completedExecutions, failedExecutions, recentExecutions] = await Promise.all([
      db.agent.count({ where: { ownerId: user.id } }),
      db.workflow.count({ where: { userId: user.id, status: { in: ['APPROVED', 'RUNNING'] } } }),
      db.paymentTransaction.aggregate({ where: { buyer: user.address, network, status: 'SETTLED' }, _sum: { amountUnits: true } }),
      db.paymentTransaction.aggregate({ where: { recipient: user.address, network, status: 'SETTLED' }, _sum: { amountUnits: true } }),
      db.execution.count({ where: { userId: user.id, status: 'COMPLETED' } }),
      db.execution.count({ where: { userId: user.id, status: 'FAILED' } }),
      db.execution.findMany({ where: { userId: user.id }, include: { agent: { select: { id: true, name: true, providerName: true } }, payment: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);
    return respond({ registeredAgents, activeWorkflows, totalSpentUnits: spending._sum.amountUnits ?? 0n, providerEarnedUnits: earnings._sum.amountUnits ?? 0n, completedExecutions, failedExecutions, recentExecutions, network });
  } catch (error) { return apiError(error); }
}
