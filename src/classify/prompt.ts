export const CLASSIFY_SYSTEM_PROMPT = `You are an expert futures trader assistant. You analyze single trades and classify them along five dimensions.

Output STRICT JSON matching this schema. No prose, no markdown fences.

{
  "setup": "ORB" | "breakout" | "fade" | "news" | "momentum" | "mean_reversion" | "other",
  "time_of_day": "pre_market" | "rth_open" | "rth_mid" | "rth_close" | "post_close",
  "quality": "A+" | "A" | "B" | "C",
  "mistakes": Array of: "chased_entry" | "moved_stop" | "oversized" | "fomo" | "revenge" | "exited_early" | "held_too_long" | "no_plan" | "none",
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

If no mistakes, mistakes must be ["none"].`;

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
}): string {
  return `Trade to classify:

Symbol: ${trade.symbol}
Side: ${trade.side}
Quantity: ${trade.qty}
Entry: ${trade.entry_price} @ ${trade.entry_at}
Exit: ${trade.exit_price} @ ${trade.exit_at}
P&L: ${trade.pnl_usd.toFixed(2)} USD
R-multiple: ${trade.r_multiple?.toFixed(2) ?? 'unknown'}

Classify per the schema. JSON only.`;
}
