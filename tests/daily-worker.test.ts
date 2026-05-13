import { describe, it, expect, vi } from 'vitest';
import { runDailyPipeline } from '../src/workers/daily-pull.js';

describe('runDailyPipeline', () => {
  it('orchestrates full pipeline with mocked dependencies', async () => {
    const mockTrade = {
      id: 't1',
      account_id: '42',
      symbol: 'MNQU5',
      side: 'buy' as const,
      qty: 2,
      entry_price: 18500,
      exit_price: 18520,
      entry_at: '2026-05-13T13:35:00Z',
      exit_at: '2026-05-13T13:55:00Z',
      pnl_usd: 40,
      commission_usd: 2.4,
    };

    const mockClassification = {
      trade_id: 't1',
      setup: 'ORB' as const,
      time_of_day: 'rth_open' as const,
      quality: 'A' as const,
      mistakes: ['none' as const],
      notes: 'ren ORB',
    };

    const deps = {
      fetchTrades: vi.fn().mockResolvedValue([mockTrade]),
      upsertTrades: vi.fn().mockResolvedValue(undefined),
      tagTrade: vi.fn().mockResolvedValue(mockClassification),
      upsertClassifications: vi.fn().mockResolvedValue(undefined),
      publishRun: vi.fn().mockResolvedValue({ runId: 'run-abc', classificationCount: 1 }),
      generateDailySummary: vi.fn().mockResolvedValue('# Summary'),
      writeMarkdownSummary: vi.fn().mockResolvedValue('/path/to/2026-05-13.md'),
      sendTelegram: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runDailyPipeline({
      date: '2026-05-13',
      accountId: 42,
      apiUrl: 'https://demo.tradovateapi.com/v1',
      accessToken: 'TOKEN',
      anthropic: {} as any,
      supabase: {} as any,
      publicSupabase: {} as any,
      brainDailyPath: '/tmp/brain',
      telegramBotToken: 'BOT',
      telegramChatId: '12345',
      deps,
    });

    expect(deps.fetchTrades).toHaveBeenCalledOnce();
    expect(deps.upsertTrades).toHaveBeenCalledWith(expect.anything(), [mockTrade]);
    expect(deps.tagTrade).toHaveBeenCalledOnce();
    expect(deps.upsertClassifications).toHaveBeenCalledWith(expect.anything(), [mockClassification]);
    expect(deps.publishRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runLabel: '2026-05-13 daily',
        source: 'tradovate',
        sourceRef: 'account-42',
        trades: [mockTrade],
        classifications: [mockClassification],
      }),
    );
    expect(deps.generateDailySummary).toHaveBeenCalledOnce();
    expect(deps.writeMarkdownSummary).toHaveBeenCalledOnce();
    expect(deps.sendTelegram).toHaveBeenCalledOnce();

    expect(result.tradesProcessed).toBe(1);
    expect(result.summaryPath).toBe('/path/to/2026-05-13.md');
    expect(result.publishedRunId).toBe('run-abc');
  });

  it('skips publishRun and Telegram on no-trade day', async () => {
    const deps = {
      fetchTrades: vi.fn().mockResolvedValue([]),
      upsertTrades: vi.fn().mockResolvedValue(undefined),
      tagTrade: vi.fn(),
      upsertClassifications: vi.fn(),
      publishRun: vi.fn(),
      generateDailySummary: vi.fn().mockResolvedValue('# No trades'),
      writeMarkdownSummary: vi.fn().mockResolvedValue('/path/2026-05-13.md'),
      sendTelegram: vi.fn(),
    };

    const result = await runDailyPipeline({
      date: '2026-05-13',
      accountId: 42,
      apiUrl: 'https://demo.tradovateapi.com/v1',
      accessToken: 'TOKEN',
      anthropic: {} as any,
      supabase: {} as any,
      publicSupabase: {} as any,
      brainDailyPath: '/tmp/brain',
      telegramBotToken: '',
      telegramChatId: '',
      deps,
    });

    expect(deps.publishRun).not.toHaveBeenCalled();
    expect(deps.sendTelegram).not.toHaveBeenCalled();
    expect(result.publishedRunId).toBeNull();
  });
});
