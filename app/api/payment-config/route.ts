import { NextResponse } from 'next/server';
import { apiError, rateLimit, requestIp } from '@/lib/api';
import { BASE_CONFIG, BUILDER_CODE } from '@/lib/chain';
import { getPaymentServer, paymentConfiguration } from '@/lib/payments/server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
  rateLimit(`payment-config:${requestIp(request)}`, 30);
  const config = paymentConfiguration();
  let facilitatorStatus = 'not-checked';
  let builderCodeSupported: boolean | null = null;
  if (new URL(request.url).searchParams.get('check') === '1' && config.enabled) {
    try {
      const server = await getPaymentServer();
      facilitatorStatus = 'supported';
      builderCodeSupported = server.getFacilitatorExtensions(2, BASE_CONFIG.network, 'exact').includes('builder-code');
    } catch { facilitatorStatus = 'unavailable'; }
  }
  return NextResponse.json({ ...BASE_CONFIG, ...config, builderCode: BUILDER_CODE, facilitatorStatus,
    builderCodeSupported, attributionStatus: 'Awaiting confirmed settlement; not verified' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
