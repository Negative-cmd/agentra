import { apiError, respond } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const user = await requireUser(); const url = new URL(request.url);
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page')) || 1));
    const status = url.searchParams.get('status');
    const where = { buyer: user.address, ...(status && ['SETTLED', 'FAILED', 'PENDING'].includes(status) ? { status } : {}) };
    const [transactions, total] = await Promise.all([db.paymentTransaction.findMany({ where, include: { execution: { include: { agent: { select: { id: true, name: true, kind: true, providerName: true } } } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 100, take: 100 }), db.paymentTransaction.count({ where })]);
    return respond({ transactions, total, page });
  } catch (error) { return apiError(error); }
}
