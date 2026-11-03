import { apiError, ApiError, rateLimit, readJson, requestIp, respond } from '@/lib/api';
import { executeService, serviceKinds, type ServiceKind } from '@/lib/services';

export async function POST(request: Request, context: { params: Promise<{ service: string }> }) {
  try {
    rateLimit(`preview:${requestIp(request)}`, 20);
    const { service } = await context.params;
    if (!serviceKinds.includes(service as ServiceKind)) throw new ApiError(404, 'Service not found');
    const body = await readJson(request, 8192);
    const input = body && typeof body === 'object' && 'input' in body ? (body as { input: unknown }).input : body;
    return respond({ output: executeService(service as ServiceKind, input), preview: true, paymentRequired: false, note: 'Free deterministic reference preview. No settlement or paid execution record is created.' });
  } catch (error) { return apiError(error); }
}
