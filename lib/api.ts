import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { jsonSafe } from './db';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function respond(value: unknown, status = 200) {
  return NextResponse.json(jsonSafe(value), { status, headers: { 'Cache-Control': 'no-store' } });
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) return respond({ error: error.message }, error.status);
  if (error instanceof ZodError) return respond({ error: 'Invalid input', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
  console.error('Agentra request failed', error instanceof Error ? error.message : 'Unknown error');
  return respond({ error: 'The request could not be completed. Please try again.' }, 500);
}

export async function readJson(request: Request, maxBytes = 65_536): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'Use application/json');
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new ApiError(413, 'Request body too large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Missing request body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, 'Request body too large'); }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
}

// Per-process abuse guard; production replicas also require a shared edge rate limiter.
const buckets = new Map<string, { count: number; expires: number }>();
export function rateLimit(key: string, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  if (buckets.size > 10_000) for (const [id, b] of buckets) if (b.expires < now) buckets.delete(id);
  const bucket = buckets.get(key);
  if (!bucket || bucket.expires < now) { buckets.set(key, { count: 1, expires: now + windowMs }); return; }
  if (bucket.count >= limit) throw new ApiError(429, 'Too many requests; please wait a moment');
  bucket.count++;
}

export function requestIp(request: Request) {
  // Forwarded IPs are not trusted for authorization; production proxy must replace them.
  return request.headers.get('x-real-ip') ?? 'local';
}
