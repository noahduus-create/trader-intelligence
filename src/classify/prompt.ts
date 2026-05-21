export const CLASSIFY_SYSTEM_PROMPT = `You are an expert futures trader assistant. You analyze single trades and classify them along five dimensions.

Output STRICT JSON matching this schema. No prose, no markdown fences.
The "reasoning" field MUST come first — write your analysis before committing to any label.

{
  "reasoning": "2-4 sentences: what was the market context at entry, was the plan followed, what went wrong or right",
  "setup": "ORB" | "breakout" | "fade" | "news" | "momentum" | "mean_reversion" | "other",
  "time_of_day": "pre_market" | "rth_open" | "rth_mid" | "rth_close" | "post_close",
  "quality": "A+" | "A" | "B" | "C",
  "entry_mistakes": Array of: "chased_entry" | "oversized" | "fomo" | "revenge" | "no_plan" | "none",
  "management_mistakes": Array of: "moved_stop" | "exited_early" | "held_too_long" | "none",
  "notes": "1-3 sentences in Danish describing what happened and what the trader might learn"
}

Definitions:
- pre_market: before 14:30 UTC (CET 16:30, US RTH open 09:30 ET)
- rth_open: first 30 min of regular trading hours
- rth_mid: middle of session
- rth_close: last 30 min of regular trading hours
- post_close: after RTH close

Quality:
- A+: textbook execution, plan followed exactly
- A: solid trade, minor imperfections
- B: questionable timing or sizing
- C: bad trade, broke rules

entry_mistakes: errors made at the moment of entry (impulsive decisions, wrong sizing, no plan).
management_mistakes: errors made after entry (stop management, exit timing).
If no mistakes in a category, use ["none"].`;

export function buildUserPrompt(trade: {
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
}): string {
  const ctx = trade.context;
  const regimeLines: string[] = [];
  if (ctx?.atr !== undefined) regimeLines.push(`ATR: ${ctx.atr.toFixed(2)}`);
  if (ctx?.atr_percentile !== undefined) regimeLines.push(`ATR percentile: ${ctx.atr_percentile}th (${ctx.atr_percentile >= 70 ? 'high-vol' : ctx.atr_percentile <= 30 ? 'low-vol' : 'normal'} regime)`);
  if (ctx?.orb_range !== undefined) regimeLines.push(`ORB range: ${ctx.orb_range.toFixed(2)}`);
  if (ctx?.orb_atr_ratio !== undefined) regimeLines.push(`ORB/ATR ratio: ${ctx.orb_atr_ratio.toFixed(2)}`);
  if (ctx?.exit_reason) regimeLines.push(`Exit reason: ${ctx.exit_reason}`);

  const regimeSection = regimeLines.length > 0
    ? `\nMarket context:\n${regimeLines.map(l => `  ${l}`).join('\n')}`
    : '';

  return `Trade to classify:

Symbol: ${trade.symbol}
Side: ${trade.side}
Quantity: ${trade.qty}
Entry: ${trade.entry_price} @ ${trade.entry_at}
Exit: ${trade.exit_price} @ ${trade.exit_at}
P&L: ${trade.pnl_usd.toFixed(2)} USD
R-multiple: ${trade.r_multiple?.toFixed(2) ?? 'unknown'}${regimeSection}

Classify per the schema. JSON only.`;
}
