// CSV input adapter. Reads the T50_MNQ backtest CSV (or any CSV with the same
// shape) and maps each row into the parallel-agent's Trade schema so the
// existing classify + publish pipeline can run without Tradovate auth.
//
// Source CSV columns (verbatim, from ~/dev/noah-trading/results/T50_MNQ_c_0_trades.csv):
//   date, direction, trade_type, bullet, entry, stop, partial_tp, full_tp,
//   exit_price, exit_reason, outcome, partial_taken, orb_range, atr,
//   orb_atr_ratio, risk_pts, pnl_pts, pnl_usd, contracts, risk_usd, dow, year
//
// Mapping notes:
//   - Trade.id is synthesized from row index + date for stable dedup.
//   - account_id and symbol are constants for the backtest.
//   - entry_at / exit_at are not in the CSV; we synthesize NY-open + NY-close
//     timestamps so the LLM has a defensible time-of-day signal. Backtests
//     are intraday so this approximation is good enough.
//   - commission_usd defaults to 0 (backtest didn't model commissions).

import type { Trade } from '../types.js';

const REQUIRED_COLS = [
  'date', 'direction', 'entry', 'stop', 'exit_price',
  'pnl_usd', 'contracts',
] as const;

export interface CsvParseOptions {
  accountId?: string;
  symbol?: string;
}

export function parseTradesCsv(csv: string, opts: CsvParseOptions = {}): Trade[] {
  const text = csv.trim();
  if (!text) throw new Error('Empty CSV');

  const lines = text.split('\n');
  const header = lines[0].split(',').map((c) => c.trim());
  for (const req of REQUIRED_COLS) {
    if (!header.includes(req)) {
      throw new Error(`Missing required column: ${req}`);
    }
  }

  const idx = (name: string) => header.indexOf(name);
  const accountId = opts.accountId ?? 'T50_MNQ_BACKTEST';
  const symbol = opts.symbol ?? 'MNQ';

  return lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    const date = cells[idx('date')].trim();
    const direction = cells[idx('direction')].trim().toLowerCase();
    if (direction !== 'long' && direction !== 'short') {
      throw new Error(`Row ${i + 2}: invalid direction "${direction}"`);
    }
    const qty = Number(cells[idx('contracts')]);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Row ${i + 2}: invalid contracts "${cells[idx('contracts')]}"`);
    }
    return {
      id: `T50_MNQ_${i + 1}_${date}`,
      account_id: accountId,
      symbol,
      side: direction === 'short' ? 'sell' : 'buy',
      qty: Math.round(qty),
      entry_price: Number(cells[idx('entry')]),
      exit_price: Number(cells[idx('exit_price')]),
      stop_price: Number(cells[idx('stop')]),
      entry_at: `${date}T13:30:00.000Z`,
      exit_at: `${date}T20:00:00.000Z`,
      pnl_usd: Number(cells[idx('pnl_usd')]),
      commission_usd: 0,
    } satisfies Trade;
  });
}
