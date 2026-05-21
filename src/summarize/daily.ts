import type Anthropic from '@anthropic-ai/sdk';
import type { Trade, Classification } from '../types.js';
import { computeRMultiple } from '../metrics/r-multiple.js';

const SUMMARY_SYSTEM = `Du er en trading-coach der skriver korte daglige sammendrag på dansk.

Givet en liste af trades + klassifikationer for en dag, skriv en markdown-rapport med:
1. # Heading med dato
2. Total P&L og antal trades
3. Win rate hvis >0 trades
4. Per-setup breakdown (hvilke setups blev brugt, hvordan performede de)
5. Identificerede entry_mistakes og management_mistakes (samlet liste, adskilt)
6. Session discipline: hvis session_metrics er til stede, inkludér en kort sektion om overtrading-signalet
7. 1-2 sætninger med dagens læring

Skriv kort. Brug bullet points. Brug markdown. INGEN prose-intro.`;

export interface SessionMetrics {
  actual_count: number;
  planned_count: number | null;
  overtrading: boolean | null;
  overtrading_ratio: number | null;
  low_quality_count: number;
  low_quality_pct: number;
}

export interface SummaryInput {
  anthropic: Anthropic;
  date: string;
  trades: Trade[];
  classifications: Classification[];
  planned_trades?: number;
  model?: string;
}

export function computeSessionMetrics(
  trades: Trade[],
  classifications: Classification[],
  plannedTrades?: number,
): SessionMetrics {
  const actual = trades.length;
  const planned = plannedTrades ?? null;
  const lowQuality = classifications.filter(c => c.quality === 'B' || c.quality === 'C').length;
  return {
    actual_count: actual,
    planned_count: planned,
    overtrading: planned !== null ? actual > planned : null,
    overtrading_ratio: planned !== null && planned > 0 ? Math.round((actual / planned) * 100) / 100 : null,
    low_quality_count: lowQuality,
    low_quality_pct: actual > 0 ? Math.round((lowQuality / actual) * 100) : 0,
  };
}

export async function generateDailySummary(input: SummaryInput): Promise<string> {
  const { anthropic, date, trades, classifications } = input;
  const model = input.model ?? 'claude-sonnet-4-6';

  const tradesWithR = trades.map(t => ({
    ...t,
    r: computeRMultiple({
      side: t.side,
      entry: t.entry_price,
      exit: t.exit_price,
      stop: t.stop_price,
      qty: t.qty,
    }),
  }));

  const metrics = computeSessionMetrics(trades, classifications, input.planned_trades);
  const metricsLines = [
    `  actual_trades: ${metrics.actual_count}`,
    metrics.planned_count !== null ? `  planned_trades: ${metrics.planned_count}` : null,
    metrics.overtrading !== null ? `  overtrading: ${metrics.overtrading} (ratio: ${metrics.overtrading_ratio}x)` : null,
    `  low_quality_trades: ${metrics.low_quality_count} (${metrics.low_quality_pct}% of session)`,
  ].filter(Boolean).join('\n');

  const userMessage = `Dato: ${date}

Session metrics:
${metricsLines}

Trades (${trades.length}):
${JSON.stringify(tradesWithR, null, 2)}

Klassifikationer:
${JSON.stringify(classifications, null, 2)}

Skriv markdown-summary.`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: SUMMARY_SYSTEM,
        cache_control: { type: 'ephemeral' },
      } as any,
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find(c => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('generateDailySummary: no text content');
  }

  return textBlock.text;
}
