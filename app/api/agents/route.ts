import { randomBytes } from 'node:crypto';
import { apiError, ApiError, rateLimit, readJson, respond } from '@/lib/api';
import { agentDto, agentInclude } from '@/lib/agents';
import { requireSameOrigin, requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { assertPublicHttps, registrationSchema, usdcToUnits } from '@/lib/validation';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mine = url.searchParams.get('mine') === 'true';
    const owner = mine ? await requireUser() : null;
    const query = (url.searchParams.get('q') ?? '').slice(0, 100);
    const category = url.searchParams.get('category');
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page')) || 1));
    const sort = url.searchParams.get('sort');
    const where = { ...(owner ? { ownerId: owner.id } : { status: 'ACTIVE' }), ...(category && category !== 'All' ? { category } : {}), ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { description: { contains: query, mode: 'insensitive' as const } }] } : {}) };
    const [agents, total] = await Promise.all([db.agent.findMany({ where, include: agentInclude, orderBy: sort === 'price-asc' ? { priceUnits: 'asc' } : sort === 'price-desc' ? { priceUnits: 'desc' } : { createdAt: 'asc' }, skip: (page - 1) * 24, take: 24 }), db.agent.count({ where })]);
    return respond({ agents: agents.map(a => agentDto(a, mine)), total, page, pageSize: 24 });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(); rateLimit(`register:${user.id}`, 10);
    const input = registrationSchema.parse(await readJson(request));
    assertPublicHttps(input.endpointUrl);
    const priceUnits = input.priceUsdc ? usdcToUnits(input.priceUsdc) : BigInt(input.priceUnits!);
    if (priceUnits <= 0n || priceUnits > 1_000_000_000n) throw new ApiError(400, 'Price must be between 0.000001 and 1,000 USDC');
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + randomBytes(4).toString('hex');
    const ownershipToken = randomBytes(24).toString('hex');
    const agent = await db.$transaction(async tx => {
      await tx.serviceCategory.upsert({ where: { name: input.category }, update: {}, create: { name: input.category } });
      await tx.providerProfile.upsert({ where: { userId: user.id }, update: { displayName: input.providerName }, create: { userId: user.id, displayName: input.providerName } });
      const agent = await tx.agent.create({ data: { slug, name: input.name, description: input.description, category: input.category, providerName: input.providerName, avatar: input.avatar, ownerId: user.id, kind: 'external', priceUnits, recipient: input.recipient.toLowerCase(), endpointUrl: input.endpointUrl, method: input.method, inputSchema: input.inputSchema as never, outputSchema: input.outputSchema as never, exampleInput: input.exampleInput as never, exampleOutput: input.exampleOutput as never, documentation: input.documentation, ownershipToken, endpoint: { create: { url: input.endpointUrl, method: input.method } } }, include: agentInclude });
      await tx.auditLog.create({ data: { userId: user.id, action: 'AGENT_SUBMITTED', target: agent.id } });
      return agent;
    });
    return respond({ agent: agentDto(agent, true), message: 'Saved for curated review. Publish the ownership token at /.well-known/agentra-verification.txt. An administrator must independently verify endpoint ownership and contract before publication; no external URL is fetched automatically.' }, 201);
  } catch (error) { return apiError(error); }
}
