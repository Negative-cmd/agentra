import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trustedAuthOrigins, canonicalAuthOrigin, isTrustedAuthOrigin, challengeAuthOrigin } from '@/lib/auth-origins';
beforeEach(() => { for (const key of ['APP_URL','VERCEL','VERCEL_ENV','VERCEL_PROJECT_PRODUCTION_URL','VERCEL_URL']) vi.stubEnv(key, ''); });
afterEach(() => vi.unstubAllEnvs());
function deployed() {
  vi.stubEnv('VERCEL','1');vi.stubEnv('VERCEL_ENV','production');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL','agentra-psi.vercel.app');
  vi.stubEnv('VERCEL_URL','agentra-build.vercel.app');
}
describe('trusted authentication origins', () => {
  it('uses the local origin outside a deployment', () => expect(canonicalAuthOrigin()).toBe('http://localhost:3000'));
  it('keeps explicitly configured local ports', () => {vi.stubEnv('APP_URL','http://localhost:3100');expect(canonicalAuthOrigin()).toBe('http://localhost:3100');});
  it('recognizes production despite missing APP_URL', () => {deployed();expect(canonicalAuthOrigin()).toBe('https://agentra-psi.vercel.app');});
  it('recovers a stale APP_URL using the trusted production domain', () => {deployed();vi.stubEnv('APP_URL','http://localhost:3000');expect(canonicalAuthOrigin()).toBe('https://agentra-psi.vercel.app');expect(isTrustedAuthOrigin('http://localhost:3000')).toBe(false);});
  it('recognizes an explicitly configured custom domain', () => {deployed();vi.stubEnv('APP_URL','https://agents.example.org');expect(isTrustedAuthOrigin('https://agents.example.org')).toBe(true);});
  it('binds challenges to the actual trusted deployment alias', () => {deployed();expect(challengeAuthOrigin(new Request('https://agentra-build.vercel.app/api/auth/nonce'))).toBe('https://agentra-build.vercel.app');});
  it('uses the trusted browser origin behind a reverse proxy', () => {deployed();expect(challengeAuthOrigin(new Request('http://localhost/api/auth/nonce',{headers:{Origin:'https://agentra-psi.vercel.app'}}))).toBe('https://agentra-psi.vercel.app');});
  it('rejects arbitrary origins, lookalike hosts, null and trailing paths', () => {deployed();for(const origin of [null,'null','https://evil.vercel.app','https://agentra-psi.vercel.app.evil.org','https://agentra-psi.vercel.app/wallet'])expect(isTrustedAuthOrigin(origin)).toBe(false);});
  it('does not trust spoofed forwarded hosts', () => {deployed();expect(challengeAuthOrigin(new Request('https://evil.example/api/auth/nonce',{headers:{'x-forwarded-host':'evil.example','origin':'https://evil.example'}}))).toBe('https://agentra-psi.vercel.app');});
  it('does not trust Vercel hostname variables outside Vercel', () => {vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL','evil.example');expect(trustedAuthOrigins()).toEqual(['http://localhost:3000']);});
  it('keeps production domains out of previews unless explicitly configured', () => {deployed();vi.stubEnv('VERCEL_ENV','preview');expect(isTrustedAuthOrigin('https://agentra-psi.vercel.app')).toBe(false);expect(canonicalAuthOrigin()).toBe('https://agentra-build.vercel.app');});
  it('fails closed if a Vercel domain is malformed and no valid origin exists', () => {deployed();vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL','good.example/evil');vi.stubEnv('VERCEL_URL','user@evil.example');expect(()=>canonicalAuthOrigin()).toThrow();});
});
