import { describe, it, expect, vi } from 'vitest';
import { upsertTrades } from '../src/persistence/trades.js';
import type { Trade } from '../src/types.js';

describe('upsertTrades', () => {
  it('calls supabase upsert with trades + r_multiple', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
    const client = { from: fromMock } as any;

    const trades: Trade[] = [
      {
        id: 'tradovate-100001-100002',
        account_id: '42',
        symbol: 'MNQU5',
        side: 'buy',
        qty: 2,
        entry_price: 18500.25,
        exit_price: 18510.50,
        stop_price: 18495.00,
        entry_at: '2026-05-13T13:30:00Z',
        exit_at: '2026-05-13T13:45:00Z',
        pnl_usd: 20.50,
        commission_usd: 2.40,
      },
    ];

    await upsertTrades(client, trades);

    expect(fromMock).toHaveBeenCalledWith('trades');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tradovate-100001-100002',
          r_multiple: expect.any(Number),
        }),
      ]),
      { onConflict: 'id' },
    );
  });

  it('throws on supabase error', async () => {
    const upsertMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'connection failed' },
    });
    const client = { from: () => ({ upsert: upsertMock }) } as any;

    await expect(upsertTrades(client, [])).rejects.toThrow(/connection failed/);
  });
});
