import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { challengeAuthOrigin } from '@/lib/auth-origins';
import { cookieOptions, createNonce, NONCE_COOKIE } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const nonce = await createNonce(request);
    const uri = challengeAuthOrigin(request);
    const response = NextResponse.json({ nonce, domain: new URL(uri).host, uri, chainId: process.env.NEXT_PUBLIC_BASE_NETWORK === 'base' ? 8453 : 84532 }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(NONCE_COOKIE, nonce, { ...cookieOptions, maxAge: 300 });
    return response;
  } catch (error) { return apiError(error); }
}
