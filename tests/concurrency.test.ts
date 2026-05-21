import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency } from '../src/lib/concurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves input order in output', async () => {
    const items = [10, 20, 30, 40, 50];
    const result = await mapWithConcurrency(items, 2, async n => n * 2);
    expect(result).toEqual([20, 40, 60, 80, 100]);
  });

  it('passes the original index to the worker fn', async () => {
    const items = ['a', 'b', 'c'];
    const indices: number[] = [];
    await mapWithConcurrency(items, 2, async (_, i) => {
      indices.push(i);
    });
    expect(indices.sort()).toEqual([0, 1, 2]);
  });

  it('respects the concurrency limit (max in-flight)', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // proves it actually parallelizes
  });

  it('completes faster than sequential when fn is async', async () => {
    const delay = 30;
    const items = [1, 2, 3, 4, 5, 6];

    const start = Date.now();
    await mapWithConcurrency(items, 3, async () => {
      await new Promise(r => setTimeout(r, delay));
    });
    const elapsed = Date.now() - start;

    // Sequential would take 6 × 30 = 180ms. Concurrency 3 should be ~60ms + overhead.
    expect(elapsed).toBeLessThan(150);
  });

  it('returns empty array for empty input', async () => {
    const fn = vi.fn();
    const result = await mapWithConcurrency([], 5, fn);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects when worker throws', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async n => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('throws when concurrency < 1', async () => {
    await expect(
      mapWithConcurrency([1, 2], 0, async n => n),
    ).rejects.toThrow(/concurrency must be >= 1/);
  });
});
