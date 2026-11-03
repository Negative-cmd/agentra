import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { apiError, rateLimit, readJson, requestIp } from '@/lib/api';
import { authenticateWallet, cookieOptions, NONCE_COOKIE, requireSameOrigin, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const requestOrigin = requireSameOrigin(request);
    rateLimit(`auth:${requestIp(request)}`, 20);
    const { message, signature } = z.object({ message: z.string().max(4096), signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(2048) }).strict().parse(await readJson(request, 8192));
    const { user, token } = await authenticateWallet(message, signature as `0x${string}`, (await cookies()).get(NONCE_COOKIE)?.value, requestOrigin);
    const response = NextResponse.json({ user }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS });
    response.cookies.set(NONCE_COOKIE, '', { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) { return apiError(error); }
}
