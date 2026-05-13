import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fetchTrades } from '../src/tradovate/fetch-trades.js';

describe('fetchTrades', () => {
  it('pairs entry+exit executions into a single trade', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/tradovate-executions.json', 'utf-8'),
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture,
    });

    const trades = await fetchTrades({
      apiUrl: 'https://demo.tradovateapi.com/v1',
      accessToken: 'TOKEN',
      accountId: 42,
      from: '2026-05-13T00:00:00Z',
      to: '2026-05-13T23:59:59Z',
      fetchImpl: fetchMock,
    });

    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: 'MNQU5',
      side: 'buy',
      qty: 2,
      entry_price: 18500.25,
      exit_price: 18510.50,
    });
  });

  it('returns empty array when no executions in range', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const trades = await fetchTrades({
      apiUrl: 'https://demo.tradovateapi.com/v1',
      accessToken: 'TOKEN',
      accountId: 42,
      from: '2026-05-13T00:00:00Z',
      to: '2026-05-13T23:59:59Z',
      fetchImpl: fetchMock,
    });

    expect(trades).toEqual([]);
  });
});
