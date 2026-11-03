import { test, expect, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import 'dotenv/config';
import { db } from '../../lib/db';

const generatedAddresses: string[] = [];
const appOrigin = process.env.APP_URL || 'http://localhost:3000';

async function installTestWallet(page: Page, rejectConnection = false) {
  const account = privateKeyToAccount(generatePrivateKey());
  generatedAddresses.push(account.address.toLowerCase());
  await page.exposeFunction('__agentraQaSign', async (message: Hex) => account.signMessage({ message: { raw: message } }));
  await page.addInitScript(({ address, reject }) => {
    const events = new Map<string, Set<(value: unknown) => void>>();
    const state = { chain: '0x1', calls: [] as string[] };
    const provider = {
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        state.calls.push(method);
        if (method === 'eth_requestAccounts') {
          if (reject) throw Object.assign(new Error('User rejected wallet connection.'), { code: 4001 });
          return [address];
        }
        if (method === 'eth_accounts') return [address];
        if (method === 'eth_chainId') return state.chain;
        if (method === 'wallet_switchEthereumChain') {
          state.chain = (params[0] as { chainId: string }).chainId;
          events.get('chainChanged')?.forEach(listener => listener(state.chain));
          return null;
        }
        if (method === 'personal_sign') {
          const sign = (window as unknown as { __agentraQaSign: (message: string) => Promise<string> }).__agentraQaSign;
          return sign(params[0] as string);
        }
        // This test wallet cannot submit transactions or sign payment payloads.
        throw new Error(`Test wallet forbids RPC method ${method}`);
      },
      on: (event: string, listener: (value: unknown) => void) => {
        const listeners = events.get(event) ?? new Set(); listeners.add(listener); events.set(event, listeners);
      },
      removeListener: (event: string, listener: (value: unknown) => void) => { events.get(event)?.delete(listener); },
    };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
    Object.defineProperty(window, '__agentraQaWalletState', { value: state, configurable: true });
  }, { address: account.address, reject: rejectConnection });
  await page.route('https://sepolia.base.org/**', async route => {
    const request = route.request().postDataJSON();
    const response = (call: { id: number }) => ({ jsonrpc: '2.0', id: call.id, result: `0x${'0'.repeat(64)}` });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(request) ? request.map(response) : response(request)) });
  });
  return account;
}
async function walletCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { __agentraQaWalletState: { calls: string[] } }).__agentraQaWalletState.calls);
}

test('connection grants no signing authority; wrong network is blocked; login and disconnect work', async ({ page }) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(appOrigin).hostname);
  const account = await installTestWallet(page);
  await page.goto(`${appOrigin}/wallet`);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('link', { name: 'Open connected wallet', exact: true })).toBeVisible();
  expect((await walletCalls(page)).filter(method => method.includes('sign'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('Switch your wallet to Base Sepolia first.');
  expect((await walletCalls(page)).filter(method => method.includes('sign'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Switch to Base Sepolia', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to Base Sepolia', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
  const session = await (await page.request.get(`${appOrigin}/api/session`)).json();
  expect(session.user.address).toBe(account.address.toLowerCase());
  const calls = await walletCalls(page);
  expect(calls.filter(method => method === 'personal_sign')).toHaveLength(1);
  expect(calls.some(method => method === 'eth_sendTransaction' || method.includes('TypedData'))).toBeFalsy();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
  expect((await (await page.request.get(`${appOrigin}/api/session`)).json()).user).toBeNull();
});

test('a rejected wallet connection produces a visible error and no session', async ({ page }) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(appOrigin).hostname);
  await installTestWallet(page, true);
  await page.goto(`${appOrigin}/wallet`);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert').first()).toContainText('User rejected wallet connection.');
  expect((await walletCalls(page)).filter(method => method.includes('sign'))).toHaveLength(0);
  expect((await (await page.request.get(`${appOrigin}/api/session`)).json()).user).toBeNull();
});

test.afterAll(async () => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(process.env.DATABASE_URL!).hostname);
  const users = await db.user.findMany({ where: { address: { in: generatedAddresses } }, select: { id: true } });
  const ids = users.map(user => user.id);
  expect(await db.execution.count({ where: { userId: { in: ids } } })).toBe(0);
  await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await tx.walletIdentity.deleteMany({ where: { userId: { in: ids } } });
    await tx.session.deleteMany({ where: { userId: { in: ids } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
  await db.$disconnect();
});
