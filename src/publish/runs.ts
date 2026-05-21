import type { SupabaseClient } from '@supabase/supabase-js';
import type { Trade, Classification } from '../types.js';
import { computeRMultiple } from '../metrics/r-multiple.js';

export interface PublishRunInput {
  publicClient: SupabaseClient;
  runLabel: string;
  source: 'tradovate' | 'csv';
  sourceRef?: string;
  trades: Trade[];
  classifications: Classification[];
}

export interface PublishedRun {
  runId: string;
  classificationCount: number;
}

export interface PatternSummary {
  headline: string;
  detail: string;
}

export function aggregatePatterns(classifications: Classification[]): PatternSummary[] {
  const mistakeCounts = new Map<string, number>();
  for (const c of classifications) {
    const allMistakes = [...c.entry_mistakes, ...c.management_mistakes];
    for (const m of allMistakes) {
      if (m === 'none') continue;
      mistakeCounts.set(m, (mistakeCounts.get(m) ?? 0) + 1);
    }
  }
  return Array.from(mistakeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mistake, count]) => ({
      headline: mistake.replace(/_/g, ' '),
      detail: `${count} of ${classifications.length} trades`,
    }));
}

export async function publishRun(input: PublishRunInput): Promise<PublishedRun> {
  const { publicClient, runLabel, source, sourceRef, trades, classifications } = input;

  const totalPnl = trades.reduce((s, t) => s + t.pnl_usd, 0);
  const wins = trades.filter(t => t.pnl_usd > 0).length;
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  const patterns = aggregatePatterns(classifications);

  const { data: runData, error: runError } = await publicClient
    .from('ti_runs')
    .insert({
      run_label: runLabel,
      source,
      source_ref: sourceRef ?? null,
      trade_count: trades.length,
      classified_count: classifications.length,
      total_pnl_usd: totalPnl,
      win_rate: winRate,
      patterns_json: patterns,
    })
    .select('id')
    .single();

  if (runError) throw new Error(`publishRun: ti_runs insert failed: ${runError.message}`);
  const runId = (runData as { id: string }).id;

  const tradeById = new Map(trades.map(t => [t.id, t]));
  const rows = classifications.map(c => {
    const trade = tradeById.get(c.trade_id);
    const r = trade ? computeRMultiple({
      side: trade.side,
      entry: trade.entry_price,
      exit: trade.exit_price,
      stop: trade.stop_price,
      qty: trade.qty,
    }) : null;
    return {
      run_id: runId,
      external_trade_id: c.trade_id,
      entry_time: trade?.entry_at ?? null,
      pnl_usd: trade?.pnl_usd ?? null,
      r_multiple: r,
      setup: c.setup,
      time_of_day: c.time_of_day,
      quality: c.quality,
      reasoning: c.reasoning,
      entry_mistakes: c.entry_mistakes.filter(m => m !== 'none'),
      management_mistakes: c.management_mistakes.filter(m => m !== 'none'),
      conditions: c.notes,
    };
  });

  if (rows.length > 0) {
    const { error: classError } = await publicClient
      .from('trade_classifications')
      .insert(rows);
    if (classError) throw new Error(`publishRun: trade_classifications insert failed: ${classError.message}`);
  }

  return { runId, classificationCount: rows.length };
}
