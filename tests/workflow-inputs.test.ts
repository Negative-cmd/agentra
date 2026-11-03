import { describe, expect, it } from 'vitest';
import { resolveStepInput } from '../lib/workflows';

describe('approved deterministic chain input transforms', () => {
  it('preserves fixed inputs without inspecting unrelated previous output', () => {
    expect(resolveStepInput('summary', { text: 'Approved text.' }, 'STATIC', { summary: 'Different' })).toEqual({ text: 'Approved text.' });
  });
  it('passes a previous summary into the approved extraction schema', () => {
    expect(resolveStepInput('extraction', { text: 'Placeholder', schema: { values: 'numbers' } }, 'PREVIOUS_TEXT', { summary: 'Revenue was 20 and 30.' })).toEqual({ text: 'Revenue was 20 and 30.', schema: { values: 'numbers' } });
  });
  it('selects the first nonempty numeric extraction field deterministically', () => {
    expect(resolveStepInput('analysis', { data: [0] }, 'PREVIOUS_NUMBERS', { data: { contacts: ['x@example.com'], values: [20, 30], otherValues: [99] } })).toEqual({ data: [20, 30] });
  });
  it('blocks missing prerequisites, invalid modes and unsupported input before payment', () => {
    expect(() => resolveStepInput('analysis', { data: [1] }, 'PREVIOUS_NUMBERS')).toThrow('Complete the previous');
    expect(() => resolveStepInput('analysis', { data: [1] }, 'PREVIOUS_NUMBERS', { data: { values: [] } })).toThrow('no nonempty numeric dataset');
    expect(() => resolveStepInput('summary', { text: 'Text.' }, 'PREVIOUS_NUMBERS', { data: { values: [1] } })).toThrow('not supported');
  });
});
