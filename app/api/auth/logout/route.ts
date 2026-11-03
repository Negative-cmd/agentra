import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { cookieOptions, endSession, requireSameOrigin, SESSION_COOKIE } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request); await endSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) { return apiError(error); }
}
