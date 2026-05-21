import { describe, it, expect, vi } from 'vitest';
import { upsertClassifications } from '../src/persistence/classifications.js';
import type { Classification } from '../src/types.js';

describe('upsertClassifications', () => {
  it('upserts to classifications table on trade_id', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
    const client = { from: fromMock } as any;

    const classifications: Classification[] = [
      {
        trade_id: 't1',
        reasoning: 'Clean ORB setup, plan followed.',
        setup: 'ORB',
        time_of_day: 'rth_open',
        quality: 'A',
        entry_mistakes: ['none'],
        management_mistakes: ['none'],
        notes: 'clean ORB',
      },
    ];

    await upsertClassifications(client, classifications);

    expect(fromMock).toHaveBeenCalledWith('classifications');
    expect(upsertMock).toHaveBeenCalledWith(classifications, { onConflict: 'trade_id' });
  });

  it('throws on supabase error', async () => {
    const upsertMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'bad insert' },
    });
    const client = { from: () => ({ upsert: upsertMock }) } as any;

    await expect(upsertClassifications(client, [])).rejects.toThrow(/bad insert/);
  });
});
