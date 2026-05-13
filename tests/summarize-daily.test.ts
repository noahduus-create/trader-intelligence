import { describe, it, expect, vi } from 'vitest';
import { generateDailySummary } from '../src/summarize/daily.js';
import type { Trade, Classification } from '../src/types.js';

describe('generateDailySummary', () => {
  it('produces markdown with date heading and metrics', async () => {
    const trades: Trade[] = [
      {
        id: 't1',
        account_id: '42',
        symbol: 'MNQU5',
        side: 'buy',
        qty: 2,
        entry_price: 18500,
        exit_price: 18520,
        entry_at: '2026-05-13T13:35:00Z',
        exit_at: '2026-05-13T13:55:00Z',
        pnl_usd: 40,
        commission_usd: 2.4,
      },
    ];
    const classifications: Classification[] = [
      {
        trade_id: 't1',
        setup: 'ORB',
        time_of_day: 'rth_open',
        quality: 'A',
        mistakes: ['none'],
        notes: 'Ren ORB.',
      },
    ];

    const sdkMock = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '# Trading Summary 2026-05-13\n\nDu havde 1 trade i dag på MNQ. Nettoresultat: +$37.60. ORB-setup, ren udførelse.',
            },
          ],
        }),
      },
    } as any;

    const md = await generateDailySummary({
      anthropic: sdkMock,
      date: '2026-05-13',
      trades,
      classifications,
    });

    expect(md).toContain('2026-05-13');
    expect(md).toContain('MNQ');
  });

  it('handles a no-trade day', async () => {
    const sdkMock = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '# Trading Summary 2026-05-13\n\nIngen trades i dag.' }],
        }),
      },
    } as any;

    const md = await generateDailySummary({
      anthropic: sdkMock,
      date: '2026-05-13',
      trades: [],
      classifications: [],
    });

    expect(md).toContain('Ingen trades');
  });
});
