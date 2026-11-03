import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { verifyMessage } from 'viem';
import { SiweMessage } from 'siwe';
import { db } from './db';
import { ApiError, rateLimit, requestIp } from './api';

export const SESSION_COOKIE = 'agentra_session';
export const NONCE_COOKIE = 'agentra_nonce';
export const SESSION_SECONDS = 2 * 60 * 60;
export const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
export const authOrigin = () => new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin !== authOrigin()) throw new ApiError(403, 'Request origin is not allowed');
}

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({ where: { id: tokenHash(token) }, include: { user: true } });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return { id: session.user.id, address: session.user.address, role: session.user.role };
}

export async function requireUser(_request?: Request) {
  const user = await currentUser();
  if (!user) throw new ApiError(401, 'Sign in with your wallet to continue');
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  const allowed = (process.env.ADMIN_WALLETS ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (user.role !== 'ADMIN' || !allowed.includes(user.address.toLowerCase())) throw new ApiError(403, 'Administrator access required');
  return user;
}

export async function createNonce(request: Request) {
  rateLimit(`nonce:${requestIp(request)}`, 30);
  const nonce = randomBytes(24).toString('hex');
  await db.authNonce.create({ data: { nonce: tokenHash(nonce), expiresAt: new Date(Date.now() + 300_000) } });
  return nonce;
}

export async function authenticateWallet(message: string, signature: `0x${string}`, nonceCookie?: string) {
  let parsed: SiweMessage;
  try { parsed = new SiweMessage(message); } catch { throw new ApiError(400, 'Invalid sign-in message'); }
  const origin = new URL(authOrigin());
  const chainId = process.env.NEXT_PUBLIC_BASE_NETWORK === 'base' ? 8453 : 84532;
  if (!nonceCookie || parsed.nonce !== nonceCookie || parsed.domain !== origin.host || parsed.uri !== origin.origin || parsed.version !== '1' || parsed.chainId !== chainId) {
    throw new ApiError(401, 'Sign-in domain, network, or nonce does not match');
  }
  const issued = Date.parse(parsed.issuedAt ?? '');
  const expiry = Date.parse(parsed.expirationTime ?? '');
  if (!Number.isFinite(issued) || issued > Date.now() + 30_000 || issued < Date.now() - 300_000 || (parsed.expirationTime && (!Number.isFinite(expiry) || expiry <= Date.now()))) throw new ApiError(401, 'Sign-in message expired');
  if (parsed.notBefore && Date.parse(parsed.notBefore) > Date.now()) throw new ApiError(401, 'Sign-in message is not active');
  const nonce = await db.authNonce.findUnique({ where: { nonce: tokenHash(nonceCookie) } });
  if (!nonce || nonce.expiresAt.getTime() <= Date.now()) throw new ApiError(401, 'Sign-in nonce expired or already used');
  let valid = false;
  try { valid = await verifyMessage({ address: parsed.address as `0x${string}`, message, signature }); } catch { /* malformed signature */ }
  if (!valid) throw new ApiError(401, 'Wallet signature could not be verified. Use an EOA wallet for this MVP.');
  const address = parsed.address.toLowerCase();
  const adminAddresses = (process.env.ADMIN_WALLETS ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const token = randomBytes(32).toString('hex');
  const user = await db.$transaction(async tx => {
    const consumed = await tx.authNonce.deleteMany({ where: { nonce: tokenHash(nonceCookie), expiresAt: { gt: new Date() } } });
    if (consumed.count !== 1) throw new ApiError(401, 'Sign-in nonce already used');
    const user = await tx.user.upsert({ where: { address }, create: { address, role: adminAddresses.includes(address) ? 'ADMIN' : 'USER', identities: { create: { address } } }, update: { lastSeenAt: new Date(), role: adminAddresses.includes(address) ? 'ADMIN' : 'USER' } });
    await tx.session.create({ data: { id: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } });
    await tx.auditLog.create({ data: { userId: user.id, action: 'AUTHENTICATED', target: address } });
    return { id: user.id, address: user.address, role: user.role };
  });
  return { token, user };
}

export async function endSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: tokenHash(token) } });
}
