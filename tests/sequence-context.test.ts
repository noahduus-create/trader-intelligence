import { describe, it, expect } from 'vitest';
import {
  buildSequenceContexts,
  classifyTimeOfDay,
  classifyDayOfWeek,
} from '../src/classify/sequence-context.js';
import type { Trade } from '../src/types.js';

function makeTrade(overrides: Partial<Trade> & Pick<Trade, 'id' | 'entry_at' | 'exit_at' | 'pnl_usd'>): Trade {
  return {
    account_id: '42',
    symbol: 'MNQU5',
    side: 'buy',
    qty: 1,
    entry_price: 100,
    exit_price: 101,
    commission_usd: 1,
    ...overrides,
  };
}

describe('classifyTimeOfDay', () => {
  it.each([
    ['2026-05-13T13:00:00Z', 'pre_market'],
    ['2026-05-13T14:29:59Z', 'pre_market'],
    ['2026-05-13T14:30:00Z', 'rth_open'],
    ['2026-05-13T14:59:59Z', 'rth_open'],
    ['2026-05-13T15:00:00Z', 'rth_mid'],
    ['2026-05-13T20:29:59Z', 'rth_mid'],
    ['2026-05-13T20:30:00Z', 'rth_close'],
    ['2026-05-13T20:59:59Z', 'rth_close'],
    ['2026-05-13T21:00:00Z', 'post_close'],
    ['2026-05-13T23:30:00Z', 'post_close'],
  ])('maps %s → %s', (iso, expected) => {
    expect(classifyTimeOfDay(iso)).toBe(expected);
  });
});

describe('classifyDayOfWeek', () => {
  it('returns lowercase day names', () => {
    // 2026-05-11 was a Monday (UTC)
    expect(classifyDayOfWeek('2026-05-11T15:00:00Z')).toBe('monday');
    expect(classifyDayOfWeek('2026-05-15T15:00:00Z')).toBe('friday');
  });
});

describe('buildSequenceContexts', () => {
  it('numbers trades by chronological order', () => {
    const trades = [
      makeTrade({ id: 'a', entry_at: '2026-05-13T15:00:00Z', exit_at: '2026-05-13T15:05:00Z', pnl_usd: 10 }),
      makeTrade({ id: 'b', entry_at: '2026-05-13T14:30:00Z', exit_at: '2026-05-13T14:35:00Z', pnl_usd: -5 }),
    ];
    const ctxs = buildSequenceContexts(trades);
    // returned in input order, but indices reflect chronology
    expect(ctxs[0]?.trade_index).toBe(2); // 'a' is 2nd chronologically
    expect(ctxs[1]?.trade_index).toBe(1); // 'b' is 1st
    expect(ctxs[0]?.total_trades_in_session).toBe(2);
  });

  it('tracks cumulative P&L before each trade', () => {
    const trades = [
      makeTrade({ id: 'a', entry_at: '2026-05-13T14:30:00Z', exit_at: '2026-05-13T14:35:00Z', pnl_usd: 20 }),
      makeTrade({ id: 'b', entry_at: '2026-05-13T15:00:00Z', exit_at: '2026-05-13T15:05:00Z', pnl_usd: -10 }),
      makeTrade({ id: 'c', entry_at: '2026-05-13T15:30:00Z', exit_at: '2026-05-13T15:35:00Z', pnl_usd: 5 }),
    ];
    const ctxs = buildSequenceContexts(trades);
    expect(ctxs[0]?.cumulative_pnl_before).toBe(0);
    expect(ctxs[1]?.cumulative_pnl_before).toBe(20);
    expect(ctxs[2]?.cumulative_pnl_before).toBe(10);
  });

  it('flags consecutive losses for revenge-trade detection', () => {
    const trades = [
      makeTrade({ id: 'a', entry_at: '2026-05-13T14:30:00Z', exit_at: '2026-05-13T14:35:00Z', pnl_usd: -10 }),
      makeTrade({ id: 'b', entry_at: '2026-05-13T14:40:00Z', exit_at: '2026-05-13T14:45:00Z', pnl_usd: -15 }),
      makeTrade({ id: 'c', entry_at: '2026-05-13T14:50:00Z', exit_at: '2026-05-13T14:55:00Z', pnl_usd: -5 }),
      makeTrade({ id: 'd', entry_at: '2026-05-13T15:10:00Z', exit_at: '2026-05-13T15:15:00Z', pnl_usd: 20 }),
    ];
    const ctxs = buildSequenceContexts(trades);
    expect(ctxs[0]?.consecutive_losses_before).toBe(0);
    expect(ctxs[1]?.consecutive_losses_before).toBe(1);
    expect(ctxs[2]?.consecutive_losses_before).toBe(2);
    expect(ctxs[3]?.consecutive_losses_before).toBe(3);
    // prior result on the winning re-entry should still be "loss"
    expect(ctxs[3]?.prior_trade_result).toBe('loss');
  });

  it('resets consecutive losses on a winning trade', () => {
    const trades = [
      makeTrade({ id: 'a', entry_at: '2026-05-13T14:30:00Z', exit_at: '2026-05-13T14:35:00Z', pnl_usd: -10 }),
      makeTrade({ id: 'b', entry_at: '2026-05-13T14:40:00Z', exit_at: '2026-05-13T14:45:00Z', pnl_usd: 25 }),
      makeTrade({ id: 'c', entry_at: '2026-05-13T14:50:00Z', exit_at: '2026-05-13T14:55:00Z', pnl_usd: -5 }),
    ];
    const ctxs = buildSequenceContexts(trades);
    expect(ctxs[2]?.consecutive_losses_before).toBe(0);
    expect(ctxs[2]?.prior_trade_result).toBe('win');
  });

  it('computes minutes_since_prior_exit', () => {
    const trades = [
      makeTrade({ id: 'a', entry_at: '2026-05-13T14:30:00Z', exit_at: '2026-05-13T14:35:00Z', pnl_usd: -10 }),
      makeTrade({ id: 'b', entry_at: '2026-05-13T14:37:00Z', exit_at: '2026-05-13T14:42:00Z', pnl_usd: -5 }),
    ];
    const ctxs = buildSequenceContexts(trades);
    expect(ctxs[0]?.minutes_since_prior_exit).toBeNull();
    expect(ctxs[1]?.minutes_since_prior_exit).toBe(2);
  });

  it('returns null prior_trade_result for the first trade', () => {
    const trades = [
      makeTrade({ id: 'a', entry_at: '2026-05-13T14:30:00Z', exit_at: '2026-05-13T14:35:00Z', pnl_usd: 10 }),
    ];
    const ctxs = buildSequenceContexts(trades);
    expect(ctxs[0]?.prior_trade_result).toBeNull();
    expect(ctxs[0]?.minutes_since_prior_exit).toBeNull();
  });

  it('handles empty array', () => {
    expect(buildSequenceContexts([])).toEqual([]);
  });
});
