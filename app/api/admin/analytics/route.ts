import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { respond, apiError } from '@/lib/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const now = new Date();
    const month = new Date(now.getTime() - 30 * 86400_000);
    const day = new Date(now.getTime() - 86400_000);
    const week = new Date(now.getTime() - 7 * 86400_000);
    const [users, daily, weekly, providers, activeAgents, endpoints, networks] = await Promise.all([
      db.user.count(), db.user.count({ where: { lastSeenAt: { gte: day } } }),
      db.user.count({ where: { lastSeenAt: { gte: week } } }),
      db.providerProfile.count(), db.agent.count({ where: { status: 'ACTIVE' } }),
      db.agentEndpoint.count({ where: { agent: { status: 'ACTIVE' } } }),
      Promise.all(['eip155:84532', 'eip155:8453'].map(async network => {
        const settled = { network, status: 'SETTLED', txHash: { not: null } };
        const [requests, payments, volume, recent, buyers, earnings, completed, failed] = await Promise.all([
          db.paymentTransaction.count({ where: { network } }),
          db.paymentTransaction.count({ where: settled }),
          db.paymentTransaction.aggregate({ where: settled, _sum: { amountUnits: true } }),
          db.paymentTransaction.aggregate({ where: { ...settled, createdAt: { gte: month } }, _sum: { amountUnits: true }, _count: true }),
          db.paymentTransaction.groupBy({ by: ['buyer'], where: settled, _count: true }),
          db.providerEarning.aggregate({ where: { payment: settled }, _sum: { amountUnits: true } }),
          db.execution.count({ where: { status: 'COMPLETED', payment: settled } }),
          db.execution.count({ where: { status: 'FAILED', payment: settled } }),
        ]);
        const returning = buyers.filter(buyer => buyer._count > 1).length;
        return {
          network, label: network.endsWith('84532') ? 'Base Sepolia (testnet)' : 'Base mainnet',
          paidRequests: requests, verifiedSettlements: payments, uniquePayingWallets: buyers.length,
          verifiedVolumeUnits: (volume._sum.amountUnits ?? 0n).toString(),
          last30DaysVerifiedVolumeUnits: (recent._sum.amountUnits ?? 0n).toString(),
          last30DaysTransactionCount: recent._count,
          providerEarningsUnits: (earnings._sum.amountUnits ?? 0n).toString(),
          marketplaceRevenueUnits: '0',
          repeatCustomerRatePercent: buyers.length ? Math.round(returning * 10_000 / buyers.length) / 100 : null,
          completedExecutions: completed, failedExecutionsAfterSettlement: failed,
        };
      }))
    ]);
    const result = {
      generatedAt: now.toISOString(), totalRegisteredUsers: users,
      dailyActiveUsers: daily, weeklyActiveUsers: weekly,
      activeUserDefinition: 'Wallets that completed a verified sign-in within the trailing 24 hours / 7 days. Browsing is not tracked.',
      registeredProviders: providers, activeAgents, publishedEndpoints: endpoints,
      marketplaceFeePolicy: 'No platform fee in this MVP; payments go directly to providers.',
      networks,
    };
    if (new URL(request.url).searchParams.get('format') === 'csv') {
      const columns = ['network','label','paidRequests','verifiedSettlements','uniquePayingWallets','verifiedVolumeUnits','last30DaysVerifiedVolumeUnits','last30DaysTransactionCount','providerEarningsUnits','marketplaceRevenueUnits','repeatCustomerRatePercent','completedExecutions','failedExecutionsAfterSettlement'] as const;
      const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      return new Response([columns.join(','), ...networks.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n'), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="agentra-verified-metrics.csv"', 'Cache-Control': 'no-store' }
      });
    }
    return respond(result);
  } catch (error) { return apiError(error); }
}
