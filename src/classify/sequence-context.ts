import type { Trade, TimeOfDay } from '../types.js';

export type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export type PriorTradeResult = 'win' | 'loss' | 'breakeven';

export interface SessionSequenceContext {
  trade_index: number;
  total_trades_in_session: number;
  cumulative_pnl_before: number;
  prior_trade_result: PriorTradeResult | null;
  consecutive_losses_before: number;
  time_of_day: TimeOfDay;
  day_of_week: DayOfWeek;
  minutes_since_prior_exit: number | null;
}

/**
 * Pre-computes per-trade session context so the classifier sees structured
 * signals (revenge sequence, time-of-day, day-of-week) instead of having to
 * derive them from a raw timestamp.
 *
 * Returns contexts in the SAME ORDER as the input array (so callers can zip).
 */
export function buildSequenceContexts(trades: readonly Trade[]): SessionSequenceContext[] {
  const sorted = [...trades].sort((a, b) => a.entry_at.localeCompare(b.entry_at));
  const total = sorted.length;

  const bySortedId = new Map<string, SessionSequenceContext>();
  let cumulativePnl = 0;
  let consecutiveLosses = 0;
  let priorResult: PriorTradeResult | null = null;
  let priorExitAt: string | null = null;

  sorted.forEach((trade, i) => {
    bySortedId.set(trade.id, {
      trade_index: i + 1,
      total_trades_in_session: total,
      cumulative_pnl_before: round2(cumulativePnl),
      prior_trade_result: priorResult,
      consecutive_losses_before: consecutiveLosses,
      time_of_day: classifyTimeOfDay(trade.entry_at),
      day_of_week: classifyDayOfWeek(trade.entry_at),
      minutes_since_prior_exit: priorExitAt
        ? Math.max(0, Math.round((Date.parse(trade.entry_at) - Date.parse(priorExitAt)) / 60000))
        : null,
    });

    cumulativePnl += trade.pnl_usd;
    if (trade.pnl_usd < 0) {
      consecutiveLosses += 1;
      priorResult = 'loss';
    } else if (trade.pnl_usd > 0) {
      consecutiveLosses = 0;
      priorResult = 'win';
    } else {
      priorResult = 'breakeven';
    }
    priorExitAt = trade.exit_at;
  });

  return trades.map(t => bySortedId.get(t.id)!);
}

/**
 * Maps a UTC timestamp to US session bucket.
 *   < 14:30 UTC  → pre_market  (US RTH opens at 14:30 UTC / 09:30 ET)
 *   14:30-15:00  → rth_open    (first 30 min)
 *   15:00-20:30  → rth_mid
 *   20:30-21:00  → rth_close   (last 30 min)
 *   ≥ 21:00      → post_close
 *
 * Note: this is a simplified mapping that ignores DST. ET shifts +/- 1h
 * relative to UTC across the year — accuracy is within one hour of the
 * boundary, which is fine for classifier signal (trader behavior near
 * the open/close is broadly stable).
 */
export function classifyTimeOfDay(isoTimestamp: string): TimeOfDay {
  const d = new Date(isoTimestamp);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutes < 14 * 60 + 30) return 'pre_market';
  if (minutes < 15 * 60) return 'rth_open';
  if (minutes < 20 * 60 + 30) return 'rth_mid';
  if (minutes < 21 * 60) return 'rth_close';
  return 'post_close';
}

export function classifyDayOfWeek(isoTimestamp: string): DayOfWeek {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date(isoTimestamp).getUTCDay()]!;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
