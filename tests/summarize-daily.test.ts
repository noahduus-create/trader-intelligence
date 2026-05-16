import { describe, it, expect, vi } from 'vitest';
import { generateDailySummary, computeSessionMetrics } from '../src/summarize/daily.js';
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
        reasoning: 'Clean ORB breakout at the open. No deviations from plan.',
        setup: 'ORB',
        time_of_day: 'rth_open',
        quality: 'A',
        entry_mistakes: ['none'],
        management_mistakes: ['none'],
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

  it('injects session metrics into the user message when planned_trades provided', async () => {
    const sdkMock = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '# Trading Summary 2026-05-13\n\nOvertrading flagged.' }],
        }),
      },
    } as any;

    await generateDailySummary({
      anthropic: sdkMock,
      date: '2026-05-13',
      trades: [
        { id: 't1', account_id: '42', symbol: 'MNQ', side: 'buy', qty: 1,
          entry_price: 100, exit_price: 101, entry_at: '2026-05-13T14:00:00Z',
          exit_at: '2026-05-13T14:30:00Z', pnl_usd: 10, commission_usd: 0 },
        { id: 't2', account_id: '42', symbol: 'MNQ', side: 'buy', qty: 1,
          entry_price: 100, exit_price: 99, entry_at: '2026-05-13T15:00:00Z',
          exit_at: '2026-05-13T15:30:00Z', pnl_usd: -10, commission_usd: 0 },
        { id: 't3', account_id: '42', symbol: 'MNQ', side: 'sell', qty: 1,
          entry_price: 101, exit_price: 100, entry_at: '2026-05-13T16:00:00Z',
          exit_at: '2026-05-13T16:30:00Z', pnl_usd: 10, commission_usd: 0 },
      ],
      classifications: [],
      planned_trades: 2,
    });

    const call = sdkMock.messages.create.mock.calls[0][0];
    const userMsg = call.messages[0].content as string;
    expect(userMsg).toContain('actual_trades: 3');
    expect(userMsg).toContain('planned_trades: 2');
    expect(userMsg).toContain('overtrading: true');
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
