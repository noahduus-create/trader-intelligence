import { describe, it, expect, vi } from 'vitest';
import { publishRun, aggregatePatterns } from '../src/publish/runs.js';
import type { Trade, Classification } from '../src/types.js';

describe('aggregatePatterns', () => {
  it('returns top 3 mistakes sorted by count, ignoring "none"', () => {
    const cls: Classification[] = [
      { trade_id: 't1', reasoning: '', setup: 'ORB', time_of_day: 'rth_open', quality: 'B', entry_mistakes: ['chased_entry', 'oversized'], management_mistakes: ['none'], notes: '' },
      { trade_id: 't2', reasoning: '', setup: 'ORB', time_of_day: 'rth_open', quality: 'C', entry_mistakes: ['chased_entry'], management_mistakes: ['none'], notes: '' },
      { trade_id: 't3', reasoning: '', setup: 'fade', time_of_day: 'rth_mid', quality: 'A', entry_mistakes: ['none'], management_mistakes: ['none'], notes: '' },
      { trade_id: 't4', reasoning: '', setup: 'fade', time_of_day: 'rth_mid', quality: 'B', entry_mistakes: ['chased_entry'], management_mistakes: ['moved_stop'], notes: '' },
    ];

    const patterns = aggregatePatterns(cls);

    expect(patterns).toHaveLength(3);
    expect(patterns[0]).toMatchObject({
      headline: 'chased entry',
      detail: '3 of 4 trades',
    });
    expect(patterns[1]?.headline).toMatch(/oversized|moved stop/);
  });

  it('returns empty array when no classifications', () => {
    expect(aggregatePatterns([])).toEqual([]);
  });

  it('returns empty array when only "none" mistakes', () => {
    const cls: Classification[] = [
      { trade_id: 't1', reasoning: '', setup: 'ORB', time_of_day: 'rth_open', quality: 'A', entry_mistakes: ['none'], management_mistakes: ['none'], notes: '' },
    ];
    expect(aggregatePatterns(cls)).toEqual([]);
  });
});

describe('publishRun', () => {
  it('inserts ti_runs row + trade_classifications rows linked by run_id', async () => {
    const insertedClassifications: unknown[] = [];

    const runsInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'run-uuid-123' },
          error: null,
        }),
      }),
    });

    const classificationsInsert = vi.fn().mockImplementation((rows) => {
      insertedClassifications.push(...rows);
      return Promise.resolve({ data: null, error: null });
    });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'ti_runs') return { insert: runsInsert };
      if (table === 'trade_classifications') return { insert: classificationsInsert };
      throw new Error(`unexpected table: ${table}`);
    });

    const client = { from: fromMock } as any;

    const trades: Trade[] = [
      {
        id: 't1',
        account_id: '42',
        symbol: 'MNQU5',
        side: 'buy',
        qty: 2,
        entry_price: 18500,
        exit_price: 18520,
        stop_price: 18490,
        entry_at: '2026-05-13T13:35:00Z',
        exit_at: '2026-05-13T13:55:00Z',
        pnl_usd: 40,
        commission_usd: 2.4,
      },
    ];

    const classifications: Classification[] = [
      {
        trade_id: 't1',
        reasoning: 'Clean ORB entry at the open. Followed the plan precisely with no deviations.',
        setup: 'ORB',
        time_of_day: 'rth_open',
        quality: 'A',
        entry_mistakes: ['none'],
        management_mistakes: ['none'],
        notes: 'ren ORB',
      },
    ];

    const result = await publishRun({
      publicClient: client,
      runLabel: '2026-05-13 daily',
      source: 'tradovate',
      sourceRef: 'account-42',
      trades,
      classifications,
    });

    expect(result.runId).toBe('run-uuid-123');
    expect(result.classificationCount).toBe(1);

    expect(runsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        run_label: '2026-05-13 daily',
        source: 'tradovate',
        source_ref: 'account-42',
        trade_count: 1,
        classified_count: 1,
        total_pnl_usd: 40,
        win_rate: 1,
      }),
    );

    expect(insertedClassifications).toEqual([
      expect.objectContaining({
        run_id: 'run-uuid-123',
        external_trade_id: 't1',
        entry_time: '2026-05-13T13:35:00Z',
        pnl_usd: 40,
        r_multiple: expect.any(Number),
        setup: 'ORB',
        time_of_day: 'rth_open',
        quality: 'A',
        reasoning: 'Clean ORB entry at the open. Followed the plan precisely with no deviations.',
        entry_mistakes: [],
        management_mistakes: [],
        conditions: 'ren ORB',
      }),
    ]);
  });

  it('skips trade_classifications insert when no classifications', async () => {
    const classInsert = vi.fn();
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'ti_runs') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'empty-run' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'trade_classifications') return { insert: classInsert };
      throw new Error(`unexpected table: ${table}`);
    });
    const client = { from: fromMock } as any;

    const result = await publishRun({
      publicClient: client,
      runLabel: 'empty',
      source: 'tradovate',
      trades: [],
      classifications: [],
    });

    expect(result.classificationCount).toBe(0);
    expect(classInsert).not.toHaveBeenCalled();
  });

  it('throws when ti_runs insert fails', async () => {
    const fromMock = vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } }),
        }),
      }),
    });
    const client = { from: fromMock } as any;

    await expect(
      publishRun({
        publicClient: client,
        runLabel: 'bad',
        source: 'tradovate',
        trades: [],
        classifications: [],
      }),
    ).rejects.toThrow(/rls denied/);
  });
});
