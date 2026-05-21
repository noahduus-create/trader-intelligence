import { describe, it, expect } from 'vitest';
import { computeSessionMetrics } from '../src/summarize/daily.js';
import type { Trade, Classification } from '../src/types.js';

const mockTrade = (id: string): Trade => ({
  id, account_id: '42', symbol: 'MNQ', side: 'buy', qty: 1,
  entry_price: 100, exit_price: 101, entry_at: '2026-05-13T14:00:00Z',
  exit_at: '2026-05-13T14:30:00Z', pnl_usd: 10, commission_usd: 0,
});

const mockClassification = (id: string, quality: 'A+' | 'A' | 'B' | 'C'): Classification => ({
  trade_id: id, reasoning: '', setup: 'ORB', time_of_day: 'rth_open',
  quality, entry_mistakes: ['none'], management_mistakes: ['none'], notes: '',
});

describe('computeSessionMetrics', () => {
  it('flags overtrading when actual exceeds planned', () => {
    const trades = [mockTrade('t1'), mockTrade('t2'), mockTrade('t3')];
    const m = computeSessionMetrics(trades, [], 2);
    expect(m.actual_count).toBe(3);
    expect(m.planned_count).toBe(2);
    expect(m.overtrading).toBe(true);
    expect(m.overtrading_ratio).toBe(1.5);
  });

  it('no overtrading when actual equals planned', () => {
    const trades = [mockTrade('t1'), mockTrade('t2')];
    const m = computeSessionMetrics(trades, [], 2);
    expect(m.overtrading).toBe(false);
    expect(m.overtrading_ratio).toBe(1);
  });

  it('overtrading is null when planned not provided', () => {
    const m = computeSessionMetrics([mockTrade('t1')], []);
    expect(m.overtrading).toBeNull();
    expect(m.planned_count).toBeNull();
    expect(m.overtrading_ratio).toBeNull();
  });

  it('computes low_quality_pct correctly', () => {
    const trades = [mockTrade('t1'), mockTrade('t2'), mockTrade('t3'), mockTrade('t4')];
    const cls = [
      mockClassification('t1', 'A+'),
      mockClassification('t2', 'A'),
      mockClassification('t3', 'B'),
      mockClassification('t4', 'C'),
    ];
    const m = computeSessionMetrics(trades, cls);
    expect(m.low_quality_count).toBe(2);
    expect(m.low_quality_pct).toBe(50);
  });

  it('returns zero low_quality_pct on empty session', () => {
    const m = computeSessionMetrics([], []);
    expect(m.low_quality_pct).toBe(0);
    expect(m.actual_count).toBe(0);
  });
});
