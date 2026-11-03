import { z } from 'zod';
import { isAddress } from 'viem';
import { isIP } from 'node:net';
import { ApiError } from './api';

export const categories = ['Research', 'Data Intelligence', 'Content', 'Computation', 'Web Automation', 'Development', 'Productivity', 'Business Intelligence'] as const;
export const usdcString = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, 'Use a positive USDC amount with at most six decimal places');
export function usdcToUnits(value: string) {
  const validated = usdcString.parse(value);
  const [whole, decimal = ''] = validated.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(decimal.padEnd(6, '0'));
}

export function assertPublicHttps(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ApiError(400, 'A valid HTTPS endpoint is required'); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash || isIP(host) || host.includes(':') || !host.includes('.') || host.endsWith('.') || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host) || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    throw new ApiError(400, 'Use a public HTTPS domain without credentials, IP addresses, or custom ports');
  }
  return parsed;
}

export function assertApprovedHost(url: string) {
  const parsed = assertPublicHttps(url);
  const hosts = (process.env.PROVIDER_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(parsed.hostname)) throw new ApiError(400, 'This provider host must be added to PROVIDER_ALLOWED_HOSTS before approval');
  return parsed;
}

const jsonObject = z.record(z.string(), z.unknown());
export const registrationSchema = z.object({
  name: z.string().trim().min(3).max(80), description: z.string().trim().min(20).max(3000),
  category: z.enum(categories), providerName: z.string().trim().min(2).max(80).default('Independent provider'),
  avatar: z.string().max(500).optional(), endpointUrl: z.string().url().max(1000), method: z.literal('POST').default('POST'),
  priceUsdc: usdcString.optional(), priceUnits: z.string().regex(/^\d{1,15}$/).optional(),
  recipient: z.string().refine(isAddress, 'Invalid recipient address'),
  inputSchema: jsonObject, outputSchema: jsonObject, exampleInput: jsonObject, exampleOutput: jsonObject,
  documentation: z.string().trim().min(10).max(10_000),
}).strict().refine(data => data.priceUsdc !== undefined || data.priceUnits !== undefined, 'A USDC price is required');

export const workflowSchema = z.object({
  name: z.string().trim().min(2).max(80), budgetUsdc: usdcString,
  steps: z.array(z.object({ agentId: z.string().min(1).max(100), input: jsonObject, capUsdc: usdcString, inputMode: z.enum(['STATIC', 'PREVIOUS_TEXT', 'PREVIOUS_NUMBERS']).default('STATIC') }).strict()).min(1).max(3),
}).strict();
