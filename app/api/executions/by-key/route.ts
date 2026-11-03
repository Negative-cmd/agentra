import { apiError, ApiError, respond } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const key = new URL(request.url).searchParams.get('key');
    if (!key || key.length > 200) throw new ApiError(400, 'A valid idempotency key is required');
    const execution = await db.execution.findUnique({ where: { idempotencyKey: key }, include: { payment: true, steps: true, agent: { select: { id: true, name: true, providerName: true } } } });
    if (!execution || execution.userId !== user.id) throw new ApiError(404, 'Execution not found');
    return respond({ execution });
  } catch (error) { return apiError(error); }
}
