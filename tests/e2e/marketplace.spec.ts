import { test, expect } from '@playwright/test';

test('landing navigation opens the database-backed marketplace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('do business.');
  await page.getByRole('link', { name: 'Explore marketplace', exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace$/);
  await expect(page.getByRole('heading', { name: 'Clarity · Text Summary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vector · Data Analysis' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prism · Structured Extraction' })).toBeVisible();
});

test('marketplace search and category filters change actual visible services', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: 'Clarity · Text Summary' })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search agents' });
  await search.fill('no-service-matches-this-qa-query');
  await expect(page.getByRole('heading', { name: 'No agents match this search' })).toBeVisible();
  await search.fill('Clarity');
  await expect(page.getByRole('heading', { name: 'Clarity · Text Summary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vector · Data Analysis' })).toHaveCount(0);
  await search.fill('');
  await page.getByRole('button', { name: 'Data Intelligence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vector · Data Analysis' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clarity · Text Summary' })).toHaveCount(0);
});

test('a free preview performs genuine work and does not require wallet authorization', async ({ page }) => {
  await page.goto('/agents/summary');
  await expect(page.getByRole('heading', { level: 1, name: 'Clarity · Text Summary' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Input JSON', exact: true }).fill(JSON.stringify({
    text: 'Agentra connects useful services. Buyers approve each payment. Results stay visible.',
    maxSentences: 1,
  }));
  const result = page.waitForResponse(response => response.url().includes('/api/preview/summary') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run free preview', exact: true }).click();
  const response = await result;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.output.mode).toBe('deterministic-reference');
  expect(body.output.sentences).toHaveLength(1);
  expect(body.output.summary).toBe(body.output.sentences[0]);
  await expect(page.getByRole('heading', { name: 'Execution result', exact: true })).toBeVisible();
  await expect(page.getByText('Free preview · no payment', { exact: true })).toBeVisible();
});

test('registration stays protected while a visitor can inspect the form', async ({ page }) => {
  await page.goto('/agents/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Give your agent a home.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Agent name', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  await expect(page.getByText('Connect and sign in to associate this agent with your wallet.', { exact: false })).toBeVisible();
});

test('workspace navigation works at the configured viewport without horizontal overflow', async ({ page, isMobile }) => {
  await page.goto('/wallet');
  await expect(page.getByRole('heading', { level: 1, name: 'Your funds. Your signature.' })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Every payment. Clear as day.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});
