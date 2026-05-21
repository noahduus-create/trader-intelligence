import { ClassificationSchema, type Classification, type Trade } from '../types.js';
import { CLASSIFY_SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { computeRMultiple } from '../metrics/r-multiple.js';

export interface OpenRouterTagInput {
  apiKey: string;
  trade: Trade;
  model?: string;
  appUrl?: string;
  appName?: string;
}

// Default free model on OpenRouter. Caller can override via --model flag.
// Updated 2026-05-21: deepseek-v4-flash:free has capacity; llama-3.3-70b:free is rate-limited upstream.
export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash:free';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

class TransientOpenRouterError extends Error {
  retryable = true;
  status: number;
  constructor(status: number, body: string) {
    super(`OpenRouter ${status}: ${body.slice(0, 200)}`);
    this.status = status;
  }
}

// Free-tier models routinely wrap structured output in markdown fences
// or prefix it with prose like "Here's the classification:". Strip the
// noise before handing to JSON.parse.
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return (fenced[1] ?? '').trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export async function tagTradeOpenRouter(input: OpenRouterTagInput): Promise<Classification> {
  const { apiKey, trade } = input;
  const model = input.model ?? DEFAULT_OPENROUTER_MODEL;

  const r = computeRMultiple({
    side: trade.side,
    entry: trade.entry_price,
    exit: trade.exit_price,
    stop: trade.stop_price,
    qty: trade.qty,
  });

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter encourages these for analytics + rate-limit fairness
      'HTTP-Referer': input.appUrl ?? 'https://noahduus.com',
      'X-Title': input.appName ?? 'trader-intelligence',
    },
    body: JSON.stringify({
      model,
      max_tokens: 768,
      temperature: 0.2,
      messages: [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt({ ...trade, r_multiple: r }) },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 429 || response.status >= 500) {
      throw new TransientOpenRouterError(response.status, body);
    }
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    const errMsg = json.error?.message ?? 'no content in response';
    throw new Error(`OpenRouter: ${errMsg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new Error(`OpenRouter: invalid JSON: ${text.slice(0, 200)}`);
  }

  return ClassificationSchema.parse({ ...(parsed as object), trade_id: trade.id });
}
