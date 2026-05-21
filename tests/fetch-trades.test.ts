import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  fetchTrades,
  pairExecutionsToTrades,
  pairExecutionsWithDiagnostics,
} from '../src/tradovate/fetch-trades.js';

interface ExecutionFixture {
  id: number;
  accountId: number;
  orderId: number;
  timestamp: string;
  action: 'Buy' | 'Sell';
  qty: number;
  price: number;
  active: boolean;
  commission: number;
  symbol: string;
}

function fill(partial: Partial<ExecutionFixture> & { id: number; action: 'Buy' | 'Sell'; qty: number; price: number; timestamp: string }): ExecutionFixture {
  return {
    accountId: 42,
    orderId: partial.id,
    active: true,
    commission: 0.60 * partial.qty,
    symbol: 'MNQU5',
    ...partial,
  };
}

describe('fetchTrades (HTTP wiring)', () => {
  it('pairs entry+exit fills into a single trade', async () => {
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

  it('returns empty array when no fills in range', async () => {
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

describe('pairExecutionsToTrades (position-state algorithm)', () => {
  it('handles the simple in-out case', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 2, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Sell', qty: 2, price: 105, timestamp: '2026-05-13T13:45:00Z' }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      side: 'buy',
      qty: 2,
      entry_price: 100,
      exit_price: 105,
      pnl_usd: 10,
    });
  });

  it('handles short side (Sell first then Buy)', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Sell', qty: 1, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Buy',  qty: 1, price: 95,  timestamp: '2026-05-13T13:45:00Z' }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      side: 'sell',
      qty: 1,
      entry_price: 100,
      exit_price: 95,
      pnl_usd: 5,
    });
  });

  it('handles scale-in: Buy 1 + Buy 1 then Sell 2', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 1, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Buy',  qty: 1, price: 102, timestamp: '2026-05-13T13:35:00Z' }),
      fill({ id: 3, action: 'Sell', qty: 2, price: 110, timestamp: '2026-05-13T13:45:00Z' }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      side: 'buy',
      qty: 2,
      entry_price: 101,
      exit_price: 110,
      pnl_usd: 18,
    });
    expect(trades[0]?.entry_at).toBe('2026-05-13T13:30:00Z');
    expect(trades[0]?.exit_at).toBe('2026-05-13T13:45:00Z');
  });

  it('handles scale-out: Buy 3 then Sell 1 + Sell 2', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 3, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Sell', qty: 1, price: 105, timestamp: '2026-05-13T13:40:00Z' }),
      fill({ id: 3, action: 'Sell', qty: 2, price: 108, timestamp: '2026-05-13T13:50:00Z' }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      side: 'buy',
      qty: 3,
      entry_price: 100,
      exit_price: 107,
      pnl_usd: 21,
    });
  });

  it('handles re-entry: Buy then Sell then Buy then Sell as two separate trades', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 1, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Sell', qty: 1, price: 105, timestamp: '2026-05-13T13:35:00Z' }),
      fill({ id: 3, action: 'Buy',  qty: 1, price: 103, timestamp: '2026-05-13T13:40:00Z' }),
      fill({ id: 4, action: 'Sell', qty: 1, price: 108, timestamp: '2026-05-13T13:45:00Z' }),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ entry_price: 100, exit_price: 105, pnl_usd: 5 });
    expect(trades[1]).toMatchObject({ entry_price: 103, exit_price: 108, pnl_usd: 5 });
  });

  it('handles reversal: Buy 2 then Sell 3 (closes long, opens 1-lot short)', () => {
    const result = pairExecutionsWithDiagnostics([
      fill({ id: 1, action: 'Buy',  qty: 2, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Sell', qty: 3, price: 105, timestamp: '2026-05-13T13:45:00Z' }),
    ]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      side: 'buy', qty: 2, entry_price: 100, exit_price: 105, pnl_usd: 10,
    });
    expect(result.unclosedPositions).toBe(1);
  });

  it('handles reversal completed: Buy 2, Sell 3, Buy 1 yields long + short closed', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 2, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Sell', qty: 3, price: 105, timestamp: '2026-05-13T13:45:00Z' }),
      fill({ id: 3, action: 'Buy',  qty: 1, price: 103, timestamp: '2026-05-13T13:55:00Z' }),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ side: 'buy',  qty: 2, entry_price: 100, exit_price: 105, pnl_usd: 10 });
    expect(trades[1]).toMatchObject({ side: 'sell', qty: 1, entry_price: 105, exit_price: 103, pnl_usd: 2 });
  });

  it('keeps symbols independent', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 1, price: 100,  timestamp: '2026-05-13T13:30:00Z', symbol: 'MNQU5' }),
      fill({ id: 2, action: 'Buy',  qty: 1, price: 2000, timestamp: '2026-05-13T13:31:00Z', symbol: 'MGCU5' }),
      fill({ id: 3, action: 'Sell', qty: 1, price: 2050, timestamp: '2026-05-13T13:45:00Z', symbol: 'MGCU5' }),
      fill({ id: 4, action: 'Sell', qty: 1, price: 105,  timestamp: '2026-05-13T13:50:00Z', symbol: 'MNQU5' }),
    ]);
    expect(trades).toHaveLength(2);
    const mnq = trades.find(t => t.symbol === 'MNQU5');
    const mgc = trades.find(t => t.symbol === 'MGCU5');
    expect(mnq).toMatchObject({ entry_price: 100,  exit_price: 105,  pnl_usd: 5 });
    expect(mgc).toMatchObject({ entry_price: 2000, exit_price: 2050, pnl_usd: 50 });
  });

  it('flags unclosed positions at end of feed', () => {
    const result = pairExecutionsWithDiagnostics([
      fill({ id: 1, action: 'Buy', qty: 1, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
    ]);
    expect(result.trades).toHaveLength(0);
    expect(result.unclosedPositions).toBe(1);
  });

  it('sums commissions across all entry and exit fills', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 1, price: 100, timestamp: '2026-05-13T13:30:00Z', commission: 0.60 }),
      fill({ id: 2, action: 'Buy',  qty: 1, price: 102, timestamp: '2026-05-13T13:35:00Z', commission: 0.60 }),
      fill({ id: 3, action: 'Sell', qty: 2, price: 110, timestamp: '2026-05-13T13:45:00Z', commission: 1.20 }),
    ]);
    expect(trades[0]?.commission_usd).toBeCloseTo(2.40);
  });

  it('splits commission proportionally on partial fills', () => {
    const result = pairExecutionsWithDiagnostics([
      fill({ id: 1, action: 'Buy',  qty: 2, price: 100, timestamp: '2026-05-13T13:30:00Z', commission: 1.20 }),
      fill({ id: 2, action: 'Sell', qty: 3, price: 105, timestamp: '2026-05-13T13:45:00Z', commission: 1.80 }),
    ]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.commission_usd).toBeCloseTo(2.40);
    expect(result.unclosedPositions).toBe(1);
  });

  it('records execution_profile with scale counts and timing spans', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 1, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Buy',  qty: 1, price: 102, timestamp: '2026-05-13T13:32:00Z' }),
      fill({ id: 3, action: 'Sell', qty: 1, price: 110, timestamp: '2026-05-13T13:40:00Z' }),
      fill({ id: 4, action: 'Sell', qty: 1, price: 112, timestamp: '2026-05-13T13:45:00Z' }),
    ]);
    expect(trades).toHaveLength(1);
    const profile = trades[0]!.execution_profile;
    expect(profile?.scale_in_count).toBe(2);
    expect(profile?.scale_out_count).toBe(2);
    expect(profile?.entry_span_seconds).toBe(120);   // 13:30 → 13:32
    expect(profile?.exit_span_seconds).toBe(300);    // 13:40 → 13:45
    expect(profile?.position_held_seconds).toBe(900); // 13:30 → 13:45
  });

  it('records scale_in_count=1, scale_out_count=1 on simple in-out', () => {
    const trades = pairExecutionsToTrades([
      fill({ id: 1, action: 'Buy',  qty: 2, price: 100, timestamp: '2026-05-13T13:30:00Z' }),
      fill({ id: 2, action: 'Sell', qty: 2, price: 105, timestamp: '2026-05-13T13:45:00Z' }),
    ]);
    expect(trades[0]?.execution_profile?.scale_in_count).toBe(1);
    expect(trades[0]?.execution_profile?.scale_out_count).toBe(1);
    expect(trades[0]?.execution_profile?.entry_span_seconds).toBe(0);
    expect(trades[0]?.execution_profile?.exit_span_seconds).toBe(0);
  });
});
