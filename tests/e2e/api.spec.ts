import { test, expect, type APIRequestContext } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';
import { randomUUID, createHash } from 'node:crypto';
import 'dotenv/config';
import { db } from '../../lib/db';

const generatedAddresses: string[] = [];
const generatedNonces: string[] = [];

type Challenge = { nonce: string; uri: string; domain: string; chainId: number };
async function signedChallenge(request: APIRequestContext, overrides: Partial<SiweMessage> = {}) {
  const response = await request.get('/api/auth/nonce');
  expect(response.ok()).toBeTruthy();
  const challenge = await response.json() as Challenge;
  const account = privateKeyToAccount(generatePrivateKey());
  generatedAddresses.push(account.address.toLowerCase());
  generatedNonces.push(challenge.nonce);
  const message = new SiweMessage({
    domain: challenge.domain,
    address: account.address,
    statement: 'Sign in to Agentra.',
    uri: challenge.uri,
    version: '1',
    chainId: challenge.chainId,
    nonce: challenge.nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 240_000).toISOString(),
    ...overrides,
  }).prepareMessage();
  const signature = await account.signMessage({ message });
  return { challenge, account, message, signature };
}
async function login(request: APIRequestContext) {
  const signed = await signedChallenge(request);
  const response = await request.post('/api/auth/verify', {
    headers: { Origin: signed.challenge.uri },
    data: { message: signed.message, signature: signed.signature },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { ...signed, user: (await response.json()).user };
}

// These tests create ephemeral EOA identities and pending QA registrations in the
// local development database. They never broadcast a transaction or hold funds.
test.beforeEach(async ({ baseURL }) => {
  const hostname = new URL(baseURL!).hostname;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(hostname);
});

test('nonce-bound EOA login creates a session and rejects nonce replay', async ({ request }) => {
  const signed = await login(request);
  const session = await request.get('/api/session');
  expect((await session.json()).user.address).toBe(signed.account.address.toLowerCase());
  const replay = await request.post('/api/auth/verify', {
    headers: { Origin: signed.challenge.uri, Cookie: `agentra_nonce=${signed.challenge.nonce}` },
    data: { message: signed.message, signature: signed.signature },
  });
  expect(replay.status()).toBe(401);
  const logout = await request.post('/api/auth/logout', { headers: { Origin: signed.challenge.uri } });
  expect(logout.status()).toBe(200);
  expect((await (await request.get('/api/session')).json()).user).toBeNull();
});

test('a valid signature for another domain cannot authenticate', async ({ request }) => {
  const signed = await signedChallenge(request, { domain: 'unauthorized.invalid' });
  const response = await request.post('/api/auth/verify', {
    headers: { Origin: signed.challenge.uri },
    data: { message: signed.message, signature: signed.signature },
  });
  expect(response.status()).toBe(401);
  expect((await (await request.get('/api/session')).json()).user).toBeNull();
});

test('expired SIWE messages and cross-origin requests are rejected', async ({ request }) => {
  const signed = await signedChallenge(request, { expirationTime: new Date(Date.now() - 60_000).toISOString() });
  const expired = await request.post('/api/auth/verify', {
    headers: { Origin: signed.challenge.uri }, data: { message: signed.message, signature: signed.signature },
  });
  expect(expired.status()).toBe(401);
  const crossOrigin = await request.post('/api/auth/verify', {
    headers: { Origin: 'https://unauthorized.invalid' }, data: { message: signed.message, signature: signed.signature },
  });
  expect(crossOrigin.status()).toBe(403);
});

test('registration requires login and persists a pending owner-only listing', async ({ request }) => {
  const listing = {
    name: `QA reference ${randomUUID().slice(0, 8)}`,
    description: 'Development integration-test listing awaiting curated ownership review.',
    category: 'Development', providerName: 'QA development provider',
    endpointUrl: 'https://provider.agentra.app/qa-reference', method: 'POST',
    priceUsdc: '0.01', recipient: '0x0000000000000000000000000000000000000001',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    exampleInput: { text: 'Test input' }, exampleOutput: { result: 'Test output' },
    documentation: 'Development-only integration-test registration, not a published live provider.',
  };
  const challenge = await (await request.get('/api/auth/nonce')).json() as Challenge;
  generatedNonces.push(challenge.nonce);
  const unauthenticated = await request.post('/api/agents', { headers: { Origin: challenge.uri }, data: listing });
  expect(unauthenticated.status()).toBe(401);
  const signed = await login(request);
  const response = await request.post('/api/agents', { headers: { Origin: signed.challenge.uri }, data: listing });
  expect(response.status(), await response.text()).toBe(201);
  const { agent } = await response.json();
  expect(agent.status).toBe('PENDING');
  const mine = await (await request.get('/api/agents?mine=true')).json();
  expect(mine.agents.some((value: { id: string }) => value.id === agent.id)).toBeTruthy();
  const publicList = await (await request.get(`/api/agents?q=${encodeURIComponent(listing.name)}`)).json();
  expect(publicList.agents.some((value: { id: string }) => value.id === agent.id)).toBeFalsy();
});

test('private-network registration and insufficient workflow budgets fail server-side', async ({ request }) => {
  const signed = await login(request);
  const privateEndpoint = await request.post('/api/agents', {
    headers: { Origin: signed.challenge.uri },
    data: {
      name: 'QA blocked endpoint', description: 'An endpoint that must never be registered or fetched.',
      category: 'Development', providerName: 'QA', endpointUrl: 'https://127.0.0.1/private',
      priceUsdc: '0.01', recipient: signed.account.address,
      inputSchema: {}, outputSchema: {}, exampleInput: {}, exampleOutput: {}, documentation: 'Should always be blocked.',
    },
  });
  expect(privateEndpoint.status()).toBe(400);
  const agents = (await (await request.get('/api/agents')).json()).agents;
  const agent = agents.find((value: { kind: string }) => value.kind !== 'external');
  expect(agent).toBeTruthy();
  const workflow = await request.post('/api/workflows', {
    headers: { Origin: signed.challenge.uri },
    data: { name: 'QA too-small budget', budgetUsdc: '0.000001', steps: [{ agentId: agent.id, input: agent.exampleInput, capUsdc: '1000' }] },
  });
  expect(workflow.status()).toBe(400);
});


test('ordinary wallet sessions cannot read administration or grant analytics', async ({ request }) => {
  const signed = await login(request);
  expect(signed.user.role).toBe('USER');
  const administration = await request.get('/api/admin');
  expect(administration.status()).toBe(403);
  const analytics = await request.get('/api/admin/analytics');
  expect(analytics.status()).toBe(403);
});


test('a wallet signature on the wrong chain is not a login authorization', async ({ request }) => {
  const signed = await signedChallenge(request, { chainId: 1 });
  const response = await request.post('/api/auth/verify', {
    headers: { Origin: signed.challenge.uri },
    data: { message: signed.message, signature: signed.signature },
  });
  expect(response.status()).toBe(401);
  expect((await (await request.get('/api/session')).json()).user).toBeNull();
});


// Remove only identities and pending listings generated by this test process.
// Never touch a payment/execution or any pre-existing user's records.
test.afterAll(async () => {
  const connection = new URL(process.env.DATABASE_URL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(connection.hostname);
  const users = await db.user.findMany({ where: { address: { in: generatedAddresses } }, select: { id: true } });
  const userIds = users.map(user => user.id);
  expect(await db.execution.count({ where: { userId: { in: userIds } } })).toBe(0);
  expect(await db.workflow.count({ where: { userId: { in: userIds } } })).toBe(0);
  await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await tx.agentEndpoint.deleteMany({ where: { agent: { ownerId: { in: userIds }, status: 'PENDING', name: { startsWith: 'QA ' } } } });
    await tx.agent.deleteMany({ where: { ownerId: { in: userIds }, status: 'PENDING', name: { startsWith: 'QA ' } } });
    await tx.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await tx.walletIdentity.deleteMany({ where: { userId: { in: userIds } } });
    await tx.session.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.authNonce.deleteMany({ where: { nonce: { in: generatedNonces.map(value => createHash('sha256').update(value).digest('hex')) } } });
  });
  await db.$disconnect();
});
