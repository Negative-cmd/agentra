import { describe, expect, it } from 'vitest';
import { assertPublicHttps, registrationSchema, usdcToUnits, workflowSchema } from '../lib/validation';
import { readJson } from '../lib/api';

describe('marketplace boundary validation', () => {
  it('keeps exact six-decimal USDC accounting', () => {
    expect(usdcToUnits('0.000001')).toBe(1n);
    expect(usdcToUnits('999.123456')).toBe(999123456n);
    expect(() => usdcToUnits('0.0000001')).toThrow();
    expect(() => usdcToUnits('1e6')).toThrow();
    expect(() => usdcToUnits('-1')).toThrow();
  });
  it('rejects loopback/private endpoints, alternate IP notation, and credentials', () => {
    for (const url of ['http://example.org/api', 'https://localhost/api', 'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1', 'https://[::1]', 'https://10.0.0.1', 'https://user:pass@agent.example.org', 'https://agent.example.org:8443', 'https://metadata.google.internal']) expect(() => assertPublicHttps(url)).toThrow();
    expect(assertPublicHttps('https://agent.example.org/api').hostname).toBe('agent.example.org');
  });
  it('rejects oversized bodies without trusting content-length', async () => {
    const request = new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2' }, body: JSON.stringify({ text: 'a'.repeat(4096) }) });
    await expect(readJson(request, 128)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects missing content type and malformed JSON', async () => {
    await expect(readJson(new Request('http://localhost/api', { method: 'POST', body: '{}' }))).rejects.toMatchObject({ status: 415 });
    await expect(readJson(new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).rejects.toMatchObject({ status: 400 });
  });
  it('bounds fixed workflows to three explicit steps', () => {
    const step = { agentId: 'summary', input: { text: 'One complete sentence.' }, capUsdc: '0.001' };
    expect(workflowSchema.parse({ name: 'Chain', budgetUsdc: '0.003', steps: [step, step, step] }).steps).toHaveLength(3);
    expect(() => workflowSchema.parse({ name: 'Chain', budgetUsdc: '0.004', steps: [step, step, step, step] })).toThrow();
  });
  it('rejects invalid provider recipient and arbitrary HTTP methods', () => {
    expect(registrationSchema.safeParse({ recipient: '0xabc', method: 'DELETE' }).success).toBe(false);
  });
});
