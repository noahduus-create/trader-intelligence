import { describe, it, expect } from 'vitest';
import { parseTradesCsv } from '../src/input/csv.js';

const MINIMAL_HEADER = 'date,direction,entry,stop,exit_price,pnl_usd,contracts';

function makeRow(overrides: Partial<{
  date: string; direction: string; entry: number; stop: number;
  exit_price: number; pnl_usd: number; contracts: number;
}> = {}): string {
  const r = { date: '2026-05-01', direction: 'long', entry: 19000, stop: 18950, exit_price: 19050, pnl_usd: 25, contracts: 1, ...overrides };
  return `${r.date},${r.direction},${r.entry},${r.stop},${r.exit_price},${r.pnl_usd},${r.contracts}`;
}

describe('parseTradesCsv', () => {
  it('parses a minimal valid long trade', () => {
    const csv = `${MINIMAL_HEADER}\n${makeRow()}`;
    const [trade] = parseTradesCsv(csv);
    expect(trade).toBeDefined();
    expect(trade!.side).toBe('buy');
    expect(trade!.entry_price).toBe(19000);
    expect(trade!.exit_price).toBe(19050);
    expect(trade!.pnl_usd).toBe(25);
    expect(trade!.qty).toBe(1);
    expect(trade!.commission_usd).toBe(0);
  });

  it('maps short direction to sell side', () => {
    const csv = `${MINIMAL_HEADER}\n${makeRow({ direction: 'short' })}`;
    const [trade] = parseTradesCsv(csv);
    expect(trade!.side).toBe('sell');
  });

  it('synthesizes entry_at / exit_at from date column', () => {
    const csv = `${MINIMAL_HEADER}\n${makeRow({ date: '2026-05-15' })}`;
    const [trade] = parseTradesCsv(csv);
    expect(trade!.entry_at).toBe('2026-05-15T13:30:00.000Z');
    expect(trade!.exit_at).toBe('2026-05-15T20:00:00.000Z');
  });

  it('throws on empty CSV', () => {
    expect(() => parseTradesCsv('')).toThrow('Empty CSV');
  });

  it('throws when a required column is missing', () => {
    const bad = 'date,direction,entry,stop,pnl_usd,contracts\n2026-05-01,long,19000,18950,25,1';
    expect(() => parseTradesCsv(bad)).toThrow('Missing required column: exit_price');
  });

  it('throws on invalid direction value', () => {
    const csv = `${MINIMAL_HEADER}\n${makeRow({ direction: 'INVALID' })}`;
    expect(() => parseTradesCsv(csv)).toThrow('invalid direction');
  });

  it('parses optional context columns when present', () => {
    const header = `${MINIMAL_HEADER},atr,orb_range,orb_atr_ratio,exit_reason`;
    const row = `${makeRow()},12.5,18.0,1.44,target`;
    const [trade] = parseTradesCsv(`${header}\n${row}`);
    expect(trade!.context?.atr).toBeCloseTo(12.5);
    expect(trade!.context?.orb_range).toBeCloseTo(18.0);
    expect(trade!.context?.exit_reason).toBe('target');
  });

  it('computes atr_percentile from the full dataset', () => {
    const header = `${MINIMAL_HEADER},atr`;
    const rows = [10, 20, 30, 40, 50].map(atr => `${makeRow()},${atr}`).join('\n');
    const trades = parseTradesCsv(`${header}\n${rows}`);
    // atr=10 is the minimum → percentile should be ≤ 20
    // atr=50 is the maximum → percentile should be 100
    expect(trades[0]!.context?.atr_percentile).toBeLessThanOrEqual(20);
    expect(trades[4]!.context?.atr_percentile).toBe(100);
  });

  it('respects accountId and symbol overrides', () => {
    const csv = `${MINIMAL_HEADER}\n${makeRow()}`;
    const [trade] = parseTradesCsv(csv, { accountId: 'MY_ACCOUNT', symbol: 'ES' });
    expect(trade!.account_id).toBe('MY_ACCOUNT');
    expect(trade!.symbol).toBe('ES');
  });

  it('returns empty array for header-only CSV', () => {
    expect(parseTradesCsv(MINIMAL_HEADER)).toHaveLength(0);
  });
});
