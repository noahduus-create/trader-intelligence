// CSV classification CLI. Bypasses Tradovate auth — reads a backtest CSV,
// classifies each trade with Claude, and publishes to public.ti_runs +
// public.trade_classifications via the same publishRun used by daily-pull.
//
// Two classification backends:
//   --classifier=cli  (default) — uses `claude -p` subprocess, bills
//                                 against Noah's Claude Code subscription
//                                 quota ($0 marginal cost). Batches
//                                 trades to reduce subprocess overhead.
//   --classifier=sdk             — uses @anthropic-ai/sdk directly. Needs
//                                 ANTHROPIC_API_KEY with credit balance.
//
// Env var support: both MC_V2_SUPABASE_URL / MC_V2_SUPABASE_SECRET_KEY
// (Noah's secrets-file naming) and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// (the daily-pull naming) are accepted.
//
// Usage:
//   source ~/.config/noah/secrets/api-keys.env
//   tsx src/cli-csv.ts --input <csv-path> [--run-label "<label>"] [--limit N]
//                      [--no-publish] [--classifier=cli|sdk] [--batch-size N]

import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseTradesCsv } from './input/csv.js';
import { tagTrade } from './classify/tag-trade.js';
import { tagTradesViaCli } from './classify/tag-trade-cli.js';
import { tagTradeOpenRouter, DEFAULT_OPENROUTER_MODEL } from './classify/tag-trade-openrouter.js';
import { makePublicClient } from './persistence/supabase.js';
import { publishRun } from './publish/runs.js';
import type { Classification, Trade } from './types.js';

type ClassifierKind = 'cli' | 'sdk' | 'openrouter';

function readEnv(): {
  supabaseUrl: string;
  supabaseKey: string;
  anthropicKey: string | undefined;
  openRouterKey: string | undefined;
} {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.MC_V2_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.MC_V2_SUPABASE_SECRET_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  if (!supabaseUrl) {
    throw new Error('Set SUPABASE_URL or MC_V2_SUPABASE_URL');
  }
  if (!supabaseKey) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or MC_V2_SUPABASE_SECRET_KEY');
  }
  return { supabaseUrl, supabaseKey, anthropicKey, openRouterKey };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function classifyAll(
  trades: Trade[],
  classifier: ClassifierKind,
  batchSize: number,
  anthropicKey: string | undefined,
  openRouterKey: string | undefined,
  openRouterModel: string,
): Promise<{ classifications: Classification[]; errors: { tradeId: string; message: string }[]; totalCost: number }> {
  const classifications: Classification[] = [];
  const errors: { tradeId: string; message: string }[] = [];
  let totalCost = 0;

  if (classifier === 'cli') {
    for (let start = 0; start < trades.length; start += batchSize) {
      const batch = trades.slice(start, start + batchSize);
      const t0 = Date.now();
      try {
        const result = await tagTradesViaCli(batch);
        classifications.push(...result.classifications);
        errors.push(...result.errors);
        totalCost += result.costUsd;
        console.log(
          `  batch ${Math.floor(start / batchSize) + 1}: ${result.classifications.length}/${batch.length} classified in ${Date.now() - t0}ms (eq cost $${result.costUsd.toFixed(4)})`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  batch ${Math.floor(start / batchSize) + 1} FAILED: ${message.slice(0, 200)}`);
        for (const t of batch) errors.push({ tradeId: t.id, message: `batch failure: ${message.slice(0, 120)}` });
      }
    }
    return { classifications, errors, totalCost };
  }

  if (classifier === 'sdk') {
    if (!anthropicKey) {
      throw new Error('classifier=sdk requires ANTHROPIC_API_KEY');
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      try {
        const c = await tagTrade({ anthropic, trade });
        classifications.push(c);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ tradeId: trade.id, message });
        if (errors.length <= 3) console.error(`  ${trade.id}: ${message.slice(0, 200)}`);
      }
      if ((i + 1) % 10 === 0 || i + 1 === trades.length) {
        console.log(`  classified ${i + 1}/${trades.length}${errors.length ? ` (${errors.length} errors)` : ''}`);
      }
    }
    return { classifications, errors, totalCost: 0 };
  }

  // OpenRouter path. Free-tier models limit to ~20 req/min, so we
  // pace requests at one every 3.5s baseline. Transient 429/5xx errors
  // get one retry with exponential backoff before we count them as a
  // hard failure.
  if (!openRouterKey) {
    throw new Error('classifier=openrouter requires OPENROUTER_API_KEY');
  }
  const PACE_MS = 3500;
  const RETRY_DELAYS = [5000, 15000]; // ms — used on transient errors
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    let lastErr: unknown;
    let ok = false;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const c = await tagTradeOpenRouter({
          apiKey: openRouterKey,
          trade,
          model: openRouterModel,
        });
        classifications.push(c);
        ok = true;
        break;
      } catch (err) {
        lastErr = err;
        const retryable = (err as { retryable?: boolean })?.retryable === true;
        if (!retryable || attempt === RETRY_DELAYS.length) break;
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
    if (!ok) {
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      errors.push({ tradeId: trade.id, message });
      if (errors.length <= 3) console.error(`  ${trade.id}: ${message.slice(0, 200)}`);
    }
    if ((i + 1) % 10 === 0 || i + 1 === trades.length) {
      console.log(`  classified ${i + 1}/${trades.length}${errors.length ? ` (${errors.length} errors)` : ''}`);
    }
    if (i + 1 < trades.length) await sleep(PACE_MS);
  }
  return { classifications, errors, totalCost: 0 };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      'run-label': { type: 'string' },
      limit: { type: 'string' },
      'no-publish': { type: 'boolean', default: false },
      classifier: { type: 'string', default: 'openrouter' },
      'batch-size': { type: 'string', default: '50' },
      model: { type: 'string' },
      'planned-trades': { type: 'string' },
    },
  });

  if (!values.input) {
    console.error(
      'Usage: tsx src/cli-csv.ts --input <csv-path> [--run-label "..."] [--limit N] [--no-publish] [--classifier=openrouter|cli|sdk] [--batch-size N] [--model <id>] [--planned-trades N]',
    );
    process.exit(1);
  }

  const classifier: ClassifierKind =
    values.classifier === 'sdk' || values.classifier === 'cli' || values.classifier === 'openrouter'
      ? (values.classifier as ClassifierKind)
      : 'openrouter';
  const batchSize = Math.max(1, Number(values['batch-size']) || 50);
  const openRouterModel = values.model ?? DEFAULT_OPENROUTER_MODEL;

  const { supabaseUrl, supabaseKey, anthropicKey, openRouterKey } = readEnv();
  const publicClient = makePublicClient({
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: supabaseKey,
  });

  const csv = await readFile(values.input, 'utf-8');
  let trades: Trade[] = parseTradesCsv(csv);
  if (values.limit) {
    const n = Number(values.limit);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid --limit: ${values.limit}`);
    }
    trades = trades.slice(0, n);
  }
  console.log(`Parsed ${trades.length} trades from ${values.input}`);
  const classifierLabel =
    classifier === 'cli'
      ? `cli (batch size ${batchSize})`
      : classifier === 'openrouter'
        ? `openrouter (${openRouterModel})`
        : 'sdk';
  console.log(`Classifier: ${classifierLabel}`);

  const t0 = Date.now();
  const { classifications, errors, totalCost } = await classifyAll(
    trades,
    classifier,
    batchSize,
    anthropicKey,
    openRouterKey,
    openRouterModel,
  );
  const elapsedSec = Math.round((Date.now() - t0) / 1000);

  console.log(`\nClassified ${classifications.length}/${trades.length} in ${elapsedSec}s${classifier === 'cli' ? ` (eq cost $${totalCost.toFixed(4)})` : ''}`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    for (const e of errors.slice(0, 5)) {
      console.log(`  ${e.tradeId}: ${e.message.slice(0, 120)}`);
    }
    if (errors.length > 5) console.log(`  … (${errors.length - 5} more)`);
  }

  if (values['no-publish']) {
    console.log('\n--no-publish set; skipping ti_runs insert.');
    return;
  }

  if (classifications.length === 0) {
    console.log('\nNo successful classifications — skipping publish.');
    return;
  }

  const runLabel =
    values['run-label'] ?? `csv:${values.input.split('/').pop() ?? 'input.csv'} ${new Date().toISOString().slice(0, 10)}`;

  const published = await publishRun({
    publicClient,
    runLabel,
    source: 'csv',
    sourceRef: values.input,
    trades,
    classifications,
  });

  console.log(`\nPublished run ${published.runId} with ${published.classificationCount} classifications.`);

  const plannedTrades = values['planned-trades'] ? Number(values['planned-trades']) : undefined;
  if (plannedTrades !== undefined && Number.isFinite(plannedTrades) && plannedTrades > 0) {
    const { computeSessionMetrics } = await import('./summarize/daily.js');
    const m = computeSessionMetrics(trades, classifications, plannedTrades);
    console.log('\nSession discipline:');
    console.log(`  Planned: ${m.planned_count} | Actual: ${m.actual_count}${m.overtrading ? ' ⚠ OVERTRADING' : ' ✓'}`);
    console.log(`  Ratio: ${m.overtrading_ratio}x | Low-quality: ${m.low_quality_count} trades (${m.low_quality_pct}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
