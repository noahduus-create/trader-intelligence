import { describe, it, expect } from 'vitest';
import { computeRMultiple } from '../src/metrics/r-multiple.js';

describe('computeRMultiple', () => {
  it('returns 1.0 for a long winner equal to initial risk', () => {
    const r = computeRMultiple({
      side: 'buy',
      entry: 100,
      exit: 110,
      stop: 90,
      qty: 1,
    });
    expect(r).toBeCloseTo(1.0, 4);
  });

  it('returns -1.0 for a long full stop-out', () => {
    const r = computeRMultiple({
      side: 'buy',
      entry: 100,
      exit: 90,
      stop: 90,
      qty: 1,
    });
    expect(r).toBeCloseTo(-1.0, 4);
  });

  it('returns 2.0 for a long winner at 2R', () => {
    const r = computeRMultiple({
      side: 'buy',
      entry: 100,
      exit: 120,
      stop: 90,
      qty: 1,
    });
    expect(r).toBeCloseTo(2.0, 4);
  });

  it('returns 1.0 for a short winner', () => {
    const r = computeRMultiple({
      side: 'sell',
      entry: 100,
      exit: 90,
      stop: 110,
      qty: 1,
    });
    expect(r).toBeCloseTo(1.0, 4);
  });

  it('returns null when stop is missing', () => {
    const r = computeRMultiple({
      side: 'buy',
      entry: 100,
      exit: 110,
      qty: 1,
    });
    expect(r).toBeNull();
  });

  it('returns null when stop equals entry (zero initial risk)', () => {
    const r = computeRMultiple({
      side: 'buy',
      entry: 100,
      exit: 110,
      stop: 100,
      qty: 1,
    });
    expect(r).toBeNull();
  });

  it('scales with qty (qty does not affect R-multiple)', () => {
    const r1 = computeRMultiple({ side: 'buy', entry: 100, exit: 110, stop: 90, qty: 1 });
    const r5 = computeRMultiple({ side: 'buy', entry: 100, exit: 110, stop: 90, qty: 5 });
    expect(r1).toBeCloseTo(r5!, 4);
  });
});
