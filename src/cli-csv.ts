// CSV classification CLI. Bypasses Tradovate auth — reads a backtest CSV,
// classifies each trade with Claude, and publishes to public.ti_runs +
// public.trade_classifications via the same publishRun used by daily-pull.
//
// Env var support: both MC_V2_SUPABASE_URL / MC_V2_SUPABASE_SECRET_KEY
// (Noah's secrets-file naming) and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// (the daily-pull naming) are accepted.
//
// Usage:
//   source ~/.config/noah/secrets/api-keys.env
//   tsx src/cli-csv.ts --input <csv-path> [--run-label "<label>"] [--limit N] [--no-publish]

import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseTradesCsv } from './input/csv.js';
import { tagTrade } from './classify/tag-trade.js';
import { makePublicClient } from './persistence/supabase.js';
import { publishRun } from './publish/runs.js';
import type { Classification, Trade } from './types.js';

function readEnv(): { supabaseUrl: string; supabaseKey: string; anthropicKey: string } {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.MC_V2_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.MC_V2_SUPABASE_SECRET_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl) {
    throw new Error('Set SUPABASE_URL or MC_V2_SUPABASE_URL');
  }
  if (!supabaseKey) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or MC_V2_SUPABASE_SECRET_KEY');
  }
  if (!anthropicKey) {
    throw new Error('Set ANTHROPIC_API_KEY');
  }
  return { supabaseUrl, supabaseKey, anthropicKey };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      'run-label': { type: 'string' },
      limit: { type: 'string' },
      'no-publish': { type: 'boolean', default: false },
    },
  });

  if (!values.input) {
    console.error('Usage: tsx src/cli-csv.ts --input <csv-path> [--run-label "..."] [--limit N] [--no-publish]');
    process.exit(1);
  }

  const { supabaseUrl, supabaseKey, anthropicKey } = readEnv();
  const anthropic = new Anthropic({ apiKey: anthropicKey });
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

  const classifications: Classification[] = [];
  const errors: { tradeId: string; message: string }[] = [];
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    try {
      const c = await tagTrade({ anthropic, trade });
      classifications.push(c);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ tradeId: trade.id, message });
    }
    if ((i + 1) % 10 === 0 || i + 1 === trades.length) {
      console.log(`  classified ${i + 1}/${trades.length}${errors.length ? ` (${errors.length} errors)` : ''}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nClassification errors: ${errors.length}`);
    for (const e of errors.slice(0, 5)) {
      console.log(`  ${e.tradeId}: ${e.message.slice(0, 120)}`);
    }
    if (errors.length > 5) console.log(`  … (${errors.length - 5} more)`);
  }

  if (values['no-publish']) {
    console.log('\n--no-publish set; skipping ti_runs insert.');
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
