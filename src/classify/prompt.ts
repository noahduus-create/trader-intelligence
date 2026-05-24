import type { SessionSequenceContext } from './sequence-context.js';
import type { ExecutionProfile } from '../types.js';

export const CLASSIFY_SYSTEM_PROMPT = `You are an expert futures trader assistant. You analyze single trades and classify them along five dimensions.

Output STRICT JSON matching this schema. No prose, no markdown fences.
The "reasoning" field MUST come first — write your analysis before committing to any label.

{
  "reasoning": "2-4 sentences: market context at entry, was the plan followed, what went wrong or right. If session_context or execution_profile shows revenge/oversize/scaled-into-loser signals, CALL THEM OUT.",
  "setup": "ORB" | "breakout" | "fade" | "news" | "momentum" | "mean_reversion" | "other",
  "time_of_day": "pre_market" | "rth_open" | "rth_mid" | "rth_close" | "post_close",
  "quality": "A+" | "A" | "B" | "C",
  "entry_mistakes": Array of: "chased_entry" | "oversized" | "fomo" | "revenge" | "no_plan" | "none",
  "management_mistakes": Array of: "moved_stop" | "exited_early" | "held_too_long" | "none",
  "notes": "1-3 sentences in Danish describing what happened and what the trader might learn"
}

Definitions:
- time_of_day: when session_context.time_of_day is provided, USE THAT VALUE — it has been pre-computed from the timestamp.
- pre_market: before US RTH open (before 14:30 UTC)
- rth_open: first 30 min of regular trading hours
- rth_mid: middle of session
- rth_close: last 30 min of regular trading hours
- post_close: after RTH close

Quality:
- A+: textbook execution, plan followed exactly
- A: solid trade, minor imperfections
- B: questionable timing or sizing
- C: bad trade, broke rules

Revenge-trade detection (CRITICAL):
A revenge trade is when the trader re-enters quickly after a loss without resetting. Flag "revenge" in entry_mistakes when ALL of these hold from session_context:
  - prior_trade_result === "loss" OR consecutive_losses_before >= 2
  - minutes_since_prior_exit !== null AND minutes_since_prior_exit < 10
  - cumulative_pnl_before is negative

Scale-discipline detection (use execution_profile when present):
  - scale_in_count >= 2 AND entry_span_seconds < 60 AND P&L is negative → likely "oversized" or impulsive add. Flag "oversized" in entry_mistakes.
  - scale_in_count >= 2 AND entry_span_seconds > 60 AND P&L is positive → planned/staged entry. NOT a mistake.
  - scale_out_count >= 2 → managed exit. If P&L is positive, this is good discipline (do not penalize).
  - scale_in_count == 1 AND scale_out_count == 1 AND position_held_seconds < 30 → market in/market out (no management); evaluate normally.

entry_mistakes: errors made at the moment of entry (impulsive decisions, wrong sizing, no plan).
management_mistakes: errors made after entry (stop management, exit timing).
If no mistakes in a category, use ["none"].`;

export interface UserPromptTrade {
  symbol: string;
  side: string;
  qty: number;
  entry_price: number;
  exit_price: number;
  entry_at: string;
  exit_at: string;
  pnl_usd: number;
  r_multiple: number | null;
  context?: {
    atr?: number;
    orb_range?: number;
    orb_atr_ratio?: number;
    exit_reason?: string;
    atr_percentile?: number;
  } | null;
  session_context?: SessionSequenceContext | null;
  execution_profile?: ExecutionProfile | null;
}

export function buildUserPrompt(trade: UserPromptTrade): string {
  const regimeSection = buildRegimeSection(trade.context);
  const sessionSection = buildSessionSection(trade.session_context);
  const profileSection = buildProfileSection(trade.execution_profile);

  return `Trade to classify:

Symbol: ${trade.symbol}
Side: ${trade.side}
Quantity: ${trade.qty}
Entry: ${trade.entry_price} @ ${trade.entry_at}
Exit: ${trade.exit_price} @ ${trade.exit_at}
P&L: ${trade.pnl_usd.toFixed(2)} USD
R-multiple: ${trade.r_multiple?.toFixed(2) ?? 'unknown'}${regimeSection}${sessionSection}${profileSection}

Classify per the schema. JSON only.`;
}

// Strip everything outside word chars, literal space, dot, hyphen. Length-capped.
// exit_reason flows from user-supplied CSV into the LLM prompt — without this
// a crafted value (newlines + JSON markers) can break out of its line and inject
// fake instructions. \s is excluded deliberately so \n, \t, etc. are killed.
export function sanitizeForPrompt(raw: string, maxLen = 50): string {
  return raw.replace(/[^\w .-]/g, '').slice(0, maxLen).trim();
}

function buildRegimeSection(ctx: UserPromptTrade['context']): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.atr !== undefined) lines.push(`ATR: ${ctx.atr.toFixed(2)}`);
  if (ctx.atr_percentile !== undefined) {
    const regime = ctx.atr_percentile >= 70 ? 'high-vol' : ctx.atr_percentile <= 30 ? 'low-vol' : 'normal';
    lines.push(`ATR percentile: ${ctx.atr_percentile}th (${regime} regime)`);
  }
  if (ctx.orb_range !== undefined) lines.push(`ORB range: ${ctx.orb_range.toFixed(2)}`);
  if (ctx.orb_atr_ratio !== undefined) lines.push(`ORB/ATR ratio: ${ctx.orb_atr_ratio.toFixed(2)}`);
  if (ctx.exit_reason) {
    const safe = sanitizeForPrompt(ctx.exit_reason);
    if (safe) lines.push(`Exit reason: "${safe}"`);
  }
  return lines.length > 0 ? `\nMarket context:\n${lines.map(l => `  ${l}`).join('\n')}` : '';
}

function buildSessionSection(sc: SessionSequenceContext | null | undefined): string {
  if (!sc) return '';
  const lines = [
    `  trade_index: ${sc.trade_index} of ${sc.total_trades_in_session} this session`,
    `  time_of_day: ${sc.time_of_day}`,
    `  day_of_week: ${sc.day_of_week}`,
    `  cumulative_pnl_before: ${sc.cumulative_pnl_before.toFixed(2)} USD`,
    `  prior_trade_result: ${sc.prior_trade_result ?? 'none (first trade)'}`,
    `  consecutive_losses_before: ${sc.consecutive_losses_before}`,
    `  minutes_since_prior_exit: ${sc.minutes_since_prior_exit ?? 'n/a (first trade)'}`,
  ];
  return `\nSession context:\n${lines.join('\n')}`;
}

function buildProfileSection(p: ExecutionProfile | null | undefined): string {
  if (!p) return '';
  const lines = [
    `  scale_in_count: ${p.scale_in_count}`,
    `  scale_out_count: ${p.scale_out_count}`,
    `  entry_span_seconds: ${p.entry_span_seconds}`,
    `  exit_span_seconds: ${p.exit_span_seconds}`,
    `  position_held_seconds: ${p.position_held_seconds}`,
  ];
  return `\nExecution profile:\n${lines.join('\n')}`;
}
