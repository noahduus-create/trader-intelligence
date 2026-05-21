import { describe, it, expect, vi } from 'vitest';
import { pairExecutionsToTrades } from '../src/tradovate/fetch-trades.js';
import { buildSequenceContexts } from '../src/classify/sequence-context.js';
import { mapWithConcurrency } from '../src/lib/concurrency.js';
import { tagTrade } from '../src/classify/tag-trade.js';

/**
 * Integration smoke test: verifies that pairing, enrichment, and classification
 * wedges flow together for a realistic day of trading.
 *
 * Scenario: 4 trades in a session designed to exercise every wedge:
 *   1. Clean small win, single in/out
 *   2. Scaled-in LOSER (added to a loser = bad discipline)
 *   3. Another loss
 *   4. Revenge re-entry 4 min after the loss (2 consecutive losses + tight gap + negative cum P&L)
 */
describe('wedge integration: executions → pairing → enrichment → classification', () => {
  it('feeds revenge signals into the classifier prompt for trade #4', async () => {
    const executions = [
      // Trade 1: simple Buy 1 / Sell 1, small win
      { id: 1,  accountId: 42, orderId: 1,  timestamp: '2026-05-13T14:35:00Z', action: 'Buy'  as const, qty: 1, price: 18500, active: true, commission: 0.60, symbol: 'MNQU5' },
      { id: 2,  accountId: 42, orderId: 1,  timestamp: '2026-05-13T14:50:00Z', action: 'Sell' as const, qty: 1, price: 18505, active: true, commission: 0.60, symbol: 'MNQU5' },

      // Trade 2: scaled-in LOSER (Buy 1, Buy 1 below initial — averaging down, classic mistake)
      { id: 3,  accountId: 42, orderId: 2,  timestamp: '2026-05-13T15:10:00Z', action: 'Buy'  as const, qty: 1, price: 18530, active: true, commission: 0.60, symbol: 'MNQU5' },
      { id: 4,  accountId: 42, orderId: 3,  timestamp: '2026-05-13T15:13:00Z', action: 'Buy'  as const, qty: 1, price: 18520, active: true, commission: 0.60, symbol: 'MNQU5' },
      { id: 5,  accountId: 42, orderId: 4,  timestamp: '2026-05-13T15:25:00Z', action: 'Sell' as const, qty: 2, price: 18500, active: true, commission: 1.20, symbol: 'MNQU5' },

      // Trade 3: another loss
      { id: 6,  accountId: 42, orderId: 5,  timestamp: '2026-05-13T15:40:00Z', action: 'Buy'  as const, qty: 1, price: 18510, active: true, commission: 0.60, symbol: 'MNQU5' },
      { id: 7,  accountId: 42, orderId: 6,  timestamp: '2026-05-13T15:48:00Z', action: 'Sell' as const, qty: 1, price: 18495, active: true, commission: 0.60, symbol: 'MNQU5' },

      // Trade 4: revenge re-entry 4 minutes later, oversized (2 contracts)
      { id: 8,  accountId: 42, orderId: 7,  timestamp: '2026-05-13T15:52:00Z', action: 'Buy'  as const, qty: 2, price: 18500, active: true, commission: 1.20, symbol: 'MNQU5' },
      { id: 9,  accountId: 42, orderId: 8,  timestamp: '2026-05-13T15:55:00Z', action: 'Sell' as const, qty: 2, price: 18485, active: true, commission: 1.20, symbol: 'MNQU5' },
    ];

    // Step 1: pair executions
    const trades = pairExecutionsToTrades(executions);
    expect(trades).toHaveLength(4);

    // Verify scale signals appeared where expected
    expect(trades[0]?.execution_profile?.scale_in_count).toBe(1);  // simple in/out
    expect(trades[1]?.execution_profile?.scale_in_count).toBe(2);  // scaled-in
    expect(trades[1]?.execution_profile?.entry_span_seconds).toBe(180); // 3 min span
    expect(trades[3]?.qty).toBe(2);                                // revenge was oversized

    // Step 2: enrich with session contexts
    const contexts = buildSequenceContexts(trades);
    expect(contexts).toHaveLength(4);

    // Trade 4 should carry the revenge signals
    expect(contexts[3]?.trade_index).toBe(4);
    expect(contexts[3]?.prior_trade_result).toBe('loss');
    expect(contexts[3]?.consecutive_losses_before).toBe(2); // trades 2 + 3 both losers
    expect(contexts[3]?.minutes_since_prior_exit).toBe(4);
    expect(contexts[3]?.cumulative_pnl_before).toBeLessThan(0); // running negative after losses

    // Step 3: classify (mocked LLM) — verify the prompt actually contains the signals
    const capturedPrompts: string[] = [];
    const stubResponse = JSON.stringify({
      reasoning: 'mocked',
      setup: 'ORB',
      time_of_day: 'rth_mid',
      quality: 'B',
      entry_mistakes: ['none'],
      management_mistakes: ['none'],
      notes: 'mocked',
    });
    const mockAnthropic = {
      messages: {
        create: vi.fn().mockImplementation(async ({ messages }: any) => {
          capturedPrompts.push(messages[0].content);
          return { content: [{ type: 'text', text: stubResponse }] };
        }),
      },
    } as any;

    const classifications = await mapWithConcurrency(trades, 2, (t, i) =>
      tagTrade({ anthropic: mockAnthropic, trade: t, sessionContext: contexts[i]! }),
    );

    expect(classifications).toHaveLength(4);
    expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(4);

    // The 4th prompt must contain the revenge + oversize signals reaching the model
    const revengePrompt = capturedPrompts[3]!;
    expect(revengePrompt).toContain('trade_index: 4 of 4');
    expect(revengePrompt).toContain('prior_trade_result: loss');
    expect(revengePrompt).toContain('consecutive_losses_before: 2');
    expect(revengePrompt).toContain('minutes_since_prior_exit: 4');
    expect(revengePrompt).toContain('scale_in_count: 1'); // 1 fill, but 2 contracts
    expect(revengePrompt).toContain('Quantity: 2');

    // The 2nd prompt (planned scale-in) must show the multi-fill entry
    const scaleInPrompt = capturedPrompts[1]!;
    expect(scaleInPrompt).toContain('scale_in_count: 2');
    expect(scaleInPrompt).toContain('entry_span_seconds: 180');
  });

  it('preserves classification order under concurrency', async () => {
    // 6 trades, concurrency 3 → workers race, but mapWithConcurrency must keep order
    const baseTrade = {
      account_id: '42',
      symbol: 'MNQU5',
      side: 'buy' as const,
      qty: 1,
      entry_price: 100,
      exit_price: 101,
      commission_usd: 1,
    };
    const trades = Array.from({ length: 6 }, (_, i) => ({
      ...baseTrade,
      id: `t${i}`,
      entry_at: `2026-05-13T14:${30 + i * 5}:00Z`,
      exit_at: `2026-05-13T14:${30 + i * 5 + 2}:00Z`,
      pnl_usd: i % 2 === 0 ? 5 : -3,
    }));

    const mockAnthropic = {
      messages: {
        create: vi.fn().mockImplementation(async ({ messages }: any) => {
          // Random delay simulates real-world out-of-order completion
          await new Promise(r => setTimeout(r, Math.random() * 20));
          const promptText = messages[0].content as string;
          const idMatch = promptText.match(/Entry: \d+ @ ([^\n]+)/);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                reasoning: idMatch?.[1] ?? 'unknown',
                setup: 'ORB',
                time_of_day: 'rth_open',
                quality: 'B',
                entry_mistakes: ['none'],
                management_mistakes: ['none'],
                notes: 'mocked',
              }),
            }],
          };
        }),
      },
    } as any;

    const contexts = buildSequenceContexts(trades);
    const classifications = await mapWithConcurrency(trades, 3, (t, i) =>
      tagTrade({ anthropic: mockAnthropic, trade: t, sessionContext: contexts[i]! }),
    );

    // Each classification's reasoning embeds the trade's entry_at — verifies
    // results stayed paired with the right input despite out-of-order completion
    for (let i = 0; i < trades.length; i++) {
      expect(classifications[i]?.reasoning).toBe(trades[i]?.entry_at);
    }
  });
});
