import type Anthropic from '@anthropic-ai/sdk';
import { ClassificationSchema, type Classification, type Trade } from '../types.js';
import { CLASSIFY_SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { computeRMultiple } from '../metrics/r-multiple.js';

export interface TagInput {
  anthropic: Anthropic;
  trade: Trade;
  model?: string;
}

export async function tagTrade(input: TagInput): Promise<Classification> {
  const { anthropic, trade } = input;
  const model = input.model ?? 'claude-haiku-4-5-20251001';

  const r = computeRMultiple({
    side: trade.side,
    entry: trade.entry_price,
    exit: trade.exit_price,
    stop: trade.stop_price,
    qty: trade.qty,
  });

  const response = await anthropic.messages.create({
    model,
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: CLASSIFY_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildUserPrompt({ ...trade, r_multiple: r }),
      },
    ],
  });

  const textBlock = response.content.find(c => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`tagTrade: no text content in response`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    throw new Error(`tagTrade: invalid JSON from LLM: ${textBlock.text.slice(0, 200)}`);
  }

  return ClassificationSchema.parse({ ...(parsed as object), trade_id: trade.id });
}
