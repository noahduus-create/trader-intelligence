import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Trade, Classification } from '../types.js';
import { fetchTrades } from '../tradovate/fetch-trades.js';
import { fetchAccessToken } from '../tradovate/auth.js';
import { makeAdminClient, makePublicClient } from '../persistence/supabase.js';
import { upsertTrades } from '../persistence/trades.js';
import { upsertClassifications } from '../persistence/classifications.js';
import { tagTrade } from '../classify/tag-trade.js';
import { generateDailySummary } from '../summarize/daily.js';
import { writeMarkdownSummary } from '../delivery/markdown.js';
import { sendTelegram } from '../delivery/telegram.js';
import { publishRun } from '../publish/runs.js';

export interface PipelineDeps {
  fetchTrades: typeof fetchTrades;
  upsertTrades: typeof upsertTrades;
  tagTrade: typeof tagTrade;
  upsertClassifications: typeof upsertClassifications;
  generateDailySummary: typeof generateDailySummary;
  writeMarkdownSummary: typeof writeMarkdownSummary;
  sendTelegram: typeof sendTelegram;
  publishRun: typeof publishRun;
}

export interface PipelineInput {
  date: string;
  accountId: number;
  apiUrl: string;
  accessToken: string;
  anthropic: Anthropic;
  supabase: SupabaseClient;
  publicSupabase: SupabaseClient;
  brainDailyPath: string;
  telegramBotToken: string;
  telegramChatId: string;
  deps?: Partial<PipelineDeps>;
}

export interface PipelineResult {
  tradesProcessed: number;
  classificationsCreated: number;
  summaryPath: string;
  publishedRunId: string | null;
}

export async function runDailyPipeline(input: PipelineInput): Promise<PipelineResult> {
  const d: PipelineDeps = {
    fetchTrades: input.deps?.fetchTrades ?? fetchTrades,
    upsertTrades: input.deps?.upsertTrades ?? upsertTrades,
    tagTrade: input.deps?.tagTrade ?? tagTrade,
    upsertClassifications: input.deps?.upsertClassifications ?? upsertClassifications,
    generateDailySummary: input.deps?.generateDailySummary ?? generateDailySummary,
    writeMarkdownSummary: input.deps?.writeMarkdownSummary ?? writeMarkdownSummary,
    sendTelegram: input.deps?.sendTelegram ?? sendTelegram,
    publishRun: input.deps?.publishRun ?? publishRun,
  };

  const from = `${input.date}T00:00:00Z`;
  const to = `${input.date}T23:59:59Z`;

  const trades: Trade[] = await d.fetchTrades({
    apiUrl: input.apiUrl,
    accessToken: input.accessToken,
    accountId: input.accountId,
    from,
    to,
  });

  if (trades.length > 0) {
    await d.upsertTrades(input.supabase, trades);
  }

  const classifications: Classification[] = [];
  for (const trade of trades) {
    const c = await d.tagTrade({ anthropic: input.anthropic, trade });
    classifications.push(c);
  }

  if (classifications.length > 0) {
    await d.upsertClassifications(input.supabase, classifications);
  }

  let publishedRunId: string | null = null;
  if (trades.length > 0) {
    const published = await d.publishRun({
      publicClient: input.publicSupabase,
      runLabel: `${input.date} daily`,
      source: 'tradovate',
      sourceRef: `account-${input.accountId}`,
      trades,
      classifications,
    });
    publishedRunId = published.runId;
  }

  const summary = await d.generateDailySummary({
    anthropic: input.anthropic,
    date: input.date,
    trades,
    classifications,
  });

  const summaryPath = await d.writeMarkdownSummary({
    baseDir: input.brainDailyPath,
    date: input.date,
    content: summary,
  });

  if (input.telegramBotToken && input.telegramChatId) {
    await d.sendTelegram({
      botToken: input.telegramBotToken,
      chatId: input.telegramChatId,
      text: summary,
    });
  }

  return {
    tradesProcessed: trades.length,
    classificationsCreated: classifications.length,
    summaryPath,
    publishedRunId,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await import('dotenv-flow/config');
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);

  const token = await fetchAccessToken({
    apiUrl: process.env.TRADOVATE_API_URL!,
    username: process.env.TRADOVATE_USERNAME!,
    password: process.env.TRADOVATE_PASSWORD!,
    appId: process.env.TRADOVATE_APP_ID!,
    appVersion: process.env.TRADOVATE_APP_VERSION ?? '1.0',
    cid: process.env.TRADOVATE_CID!,
    sec: process.env.TRADOVATE_SEC!,
  });

  const supabaseEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const result = await runDailyPipeline({
    date,
    accountId: Number(process.env.TRADOVATE_ACCOUNT_ID!),
    apiUrl: process.env.TRADOVATE_API_URL!,
    accessToken: token.accessToken,
    anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    supabase: makeAdminClient(supabaseEnv),
    publicSupabase: makePublicClient(supabaseEnv),
    brainDailyPath: process.env.BRAIN_DAILY_PATH!,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  });

  console.log(JSON.stringify(result, null, 2));
}
