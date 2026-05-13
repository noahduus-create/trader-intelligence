import { describe, it, expect } from 'vitest';
import { TradeSchema, ClassificationSchema } from '../src/types.js';

describe('TradeSchema', () => {
  it('parses a valid trade', () => {
    const valid = {
      id: 'tradovate-12345',
      account_id: 'A1',
      symbol: 'MNQU5',
      side: 'buy' as const,
      qty: 2,
      entry_price: 18500.25,
      exit_price: 18510.50,
      stop_price: 18495.00,
      entry_at: '2026-05-13T13:30:00Z',
      exit_at: '2026-05-13T13:45:00Z',
      pnl_usd: 41.0,
      commission_usd: 1.20,
    };
    expect(() => TradeSchema.parse(valid)).not.toThrow();
  });

  it('rejects a trade with negative qty', () => {
    expect(() => TradeSchema.parse({ qty: -1 })).toThrow();
  });
});

describe('ClassificationSchema', () => {
  it('parses a valid classification', () => {
    const valid = {
      trade_id: 'tradovate-12345',
      setup: 'ORB' as const,
      time_of_day: 'pre_market' as const,
      quality: 'A' as const,
      mistakes: ['chased_entry'] as const,
      notes: 'Entered 3 ticks late on a clean break of premarket high.',
    };
    expect(() => ClassificationSchema.parse(valid)).not.toThrow();
  });
});
