import type Anthropic from '@anthropic-ai/sdk';
import type { Trade, Classification } from '../types.js';
import { computeRMultiple } from '../metrics/r-multiple.js';

const SUMMARY_SYSTEM = `Du er en trading-coach der skriver korte daglige sammendrag på dansk.

Givet en liste af trades + klassifikationer for en dag, skriv en markdown-rapport med:
1. # Heading med dato
2. Total P&L og antal trades
3. Win rate hvis >0 trades
4. Per-setup breakdown (hvilke setups blev brugt, hvordan performede de)
5. Identificerede mistakes (samlet liste)
6. 1-2 sætninger med dagens læring

Skriv kort. Brug bullet points. Brug markdown. INGEN prose-intro.`;

export interface SummaryInput {
  anthropic: Anthropic;
  date: string;
  trades: Trade[];
  classifications: Classification[];
  model?: string;
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

  const userMessage = `Dato: ${date}

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
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find(c => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('generateDailySummary: no text content');
  }

  return textBlock.text;
}
