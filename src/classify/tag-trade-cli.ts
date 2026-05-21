// Batch classifier that calls `claude -p` subprocess instead of the
// Anthropic SDK directly. Bills against Noah's Claude Code subscription
// quota — $0 marginal cost — at the price of: (a) no prompt caching
// (subscription is flat-billed so caching gains are moot), (b) one
// subprocess spawn per batch (slower than SDK).
//
// Strategy: send N trades per call, get back a JSON object keyed by
// trade id. Validate each with the existing Zod ClassificationSchema.
// Recoverable per-batch failures don't kill the run — they just leave
// those trades unclassified (publishRun handles empty classifications).

import { spawn } from 'node:child_process';
import { ClassificationSchema, type Classification, type Trade } from '../types.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

const SYSTEM_RULES = `You are a trade-classification assistant for a futures day trader.
For each trade in the batch, reason first — then classify on six dimensions.

Allowed values:
- reasoning: 1-3 sentences on market context at entry, whether the plan was followed, what went wrong or right. Write this FIRST.
- setup: "ORB" | "breakout" | "fade" | "news" | "momentum" | "mean_reversion" | "other"
- time_of_day: "pre_market" | "rth_open" | "rth_mid" | "rth_close" | "post_close"
  (rth_open = 09:30-10:30 NY, rth_mid = 10:30-14:30 NY, rth_close = 14:30-16:00 NY)
- quality: "A+" | "A" | "B" | "C"  (A+ textbook, A clean, B workable, C sloppy)
- entry_mistakes: entry-time errors — array of: "chased_entry" | "oversized" | "fomo" | "revenge" | "no_plan" | "none"
- management_mistakes: post-entry errors — array of: "moved_stop" | "exited_early" | "held_too_long" | "none"
- notes: short string (<= 200 chars) describing market context — never invent specifics

Output strictly: a single JSON object where each KEY is the trade.id and each VALUE is { reasoning, setup, time_of_day, quality, entry_mistakes, management_mistakes, notes }. No markdown fences, no prose.`;

function buildBatchPrompt(trades: Trade[]): string {
  const compact = trades.map((t) => {
    const base: Record<string, unknown> = {
      id: t.id,
      side: t.side,
      entry_at: t.entry_at,
      exit_at: t.exit_at,
      entry: t.entry_price,
      exit: t.exit_price,
      stop: t.stop_price,
      qty: t.qty,
      pnl_usd: t.pnl_usd,
    };
    if (t.context) {
      const ctx = t.context;
      if (ctx.atr !== undefined) base.atr = ctx.atr;
      if (ctx.atr_percentile !== undefined) base.atr_percentile = ctx.atr_percentile;
      if (ctx.orb_range !== undefined) base.orb_range = ctx.orb_range;
      if (ctx.orb_atr_ratio !== undefined) base.orb_atr_ratio = ctx.orb_atr_ratio;
      if (ctx.exit_reason) base.exit_reason = ctx.exit_reason;
    }
    return base;
  });
  return `${SYSTEM_RULES}\n\nTrades batch (${trades.length} items):\n${JSON.stringify(compact, null, 2)}\n\nReply with a JSON object keyed by trade id.`;
}

function runCmd(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // CRITICAL: strip ANTHROPIC_API_KEY from the child env.
    // `claude -p` prefers an API key over the Claude Code subscription
    // when one is set, which routes billing back to the pay-as-you-go
    // API balance — defeating the whole point of using the subprocess.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (stdout.trim()) return resolve(stdout);
      if (code !== 0) {
        return reject(new Error(`${bin} exit ${code}: ${stderr.slice(0, 600)}`));
      }
      resolve(stdout);
    });
  });
}

interface ClaudeEnvelope {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  api_error_status?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '').trim() : text.trim();
}

export interface BatchResult {
  classifications: Classification[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  errors: { tradeId: string; message: string }[];
}

export async function tagTradesViaCli(trades: Trade[]): Promise<BatchResult> {
  if (trades.length === 0) {
    return { classifications: [], costUsd: 0, inputTokens: 0, outputTokens: 0, errors: [] };
  }

  const prompt = buildBatchPrompt(trades);
  const args = [
    '-p', prompt,
    '--model', 'haiku',
    '--output-format', 'json',
    '--no-session-persistence',
  ];

  const raw = await runCmd(CLAUDE_BIN, args);
  let envelope: ClaudeEnvelope;
  try {
    envelope = JSON.parse(raw);
  } catch (err) {
    throw new Error(`claude -p returned non-JSON envelope: ${raw.slice(0, 400)}`);
  }
  if (envelope.is_error || envelope.subtype !== 'success') {
    throw new Error(`claude -p error: subtype=${envelope.subtype} status=${envelope.api_error_status ?? 'n/a'}`);
  }
  if (!envelope.result) {
    throw new Error('claude -p returned no result text');
  }

  const cleaned = stripCodeFences(envelope.result);
  let map: Record<string, unknown>;
  try {
    map = JSON.parse(cleaned);
  } catch {
    throw new Error(`claude returned non-JSON content: ${cleaned.slice(0, 400)}`);
  }

  const classifications: Classification[] = [];
  const errors: BatchResult['errors'] = [];
  for (const trade of trades) {
    const raw = map[trade.id];
    if (!raw) {
      errors.push({ tradeId: trade.id, message: 'missing from response' });
      continue;
    }
    try {
      const parsed = ClassificationSchema.parse({ trade_id: trade.id, ...(raw as object) });
      classifications.push(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ tradeId: trade.id, message: msg.slice(0, 200) });
    }
  }

  return {
    classifications,
    costUsd: Number(envelope.total_cost_usd ?? 0),
    inputTokens: envelope.usage?.input_tokens ?? 0,
    outputTokens: envelope.usage?.output_tokens ?? 0,
    errors,
  };
}
