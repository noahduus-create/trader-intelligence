import { describe, it, expect, vi } from 'vitest';
import { tagTrade } from '../src/classify/tag-trade.js';
import type { Trade } from '../src/types.js';

describe('tagTrade', () => {
  it('returns parsed classification on valid LLM response', async () => {
    const llmJson = JSON.stringify({
      reasoning: 'Opened long on the ORB breakout at 09:31. Plan was followed exactly with no deviations.',
      setup: 'ORB',
      time_of_day: 'rth_open',
      quality: 'A',
      entry_mistakes: ['none'],
      management_mistakes: ['none'],
      notes: 'Ren ORB-breakout, fulgte planen.',
    });

    const sdkMock = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: llmJson }],
        }),
      },
    } as any;

    const trade: Trade = {
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
    };

    const result = await tagTrade({ anthropic: sdkMock, trade, model: 'claude-haiku-4-5-20251001' });

    expect(result.setup).toBe('ORB');
    expect(result.time_of_day).toBe('rth_open');
    expect(result.quality).toBe('A');
    expect(result.entry_mistakes).toEqual(['none']);
    expect(result.management_mistakes).toEqual(['none']);
    expect(result.notes).toContain('ORB');
  });

  it('throws on unparseable LLM output', async () => {
    const sdkMock = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'not json at all' }],
        }),
      },
    } as any;

    const trade: Trade = {
      id: 't1',
      account_id: '42',
      symbol: 'MNQU5',
      side: 'buy',
      qty: 1,
      entry_price: 100,
      exit_price: 101,
      entry_at: '2026-05-13T13:30:00Z',
      exit_at: '2026-05-13T13:45:00Z',
      pnl_usd: 1,
      commission_usd: 1,
    };

    await expect(
      tagTrade({ anthropic: sdkMock, trade, model: 'claude-haiku-4-5-20251001' }),
    ).rejects.toThrow();
  });

  it('uses prompt caching (cache_control on system message)', async () => {
    const sdkMock = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                reasoning: 'Mid-session fade attempt. Entry was reactive to news spike.',
                setup: 'other',
                time_of_day: 'rth_mid',
                quality: 'B',
                entry_mistakes: ['none'],
                management_mistakes: ['none'],
                notes: 'test',
              }),
            },
          ],
        }),
      },
    } as any;

    const trade: Trade = {
      id: 't1',
      account_id: '42',
      symbol: 'MNQU5',
      side: 'buy',
      qty: 1,
      entry_price: 100,
      exit_price: 101,
      entry_at: '2026-05-13T13:30:00Z',
      exit_at: '2026-05-13T13:45:00Z',
      pnl_usd: 1,
      commission_usd: 1,
    };

    await tagTrade({ anthropic: sdkMock, trade, model: 'claude-haiku-4-5-20251001' });

    const call = sdkMock.messages.create.mock.calls[0][0];
    expect(call.system).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          cache_control: { type: 'ephemeral' },
        }),
      ]),
    );
  });
});
