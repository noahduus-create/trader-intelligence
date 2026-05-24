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
//   - context fields (atr, orb_range, orb_atr_ratio, exit_reason) are captured
//     when present and atr_percentile is computed across the full dataset.

import type { Trade } from '../types.js';

const REQUIRED_COLS = [
  'date', 'direction', 'entry', 'stop', 'exit_price',
  'pnl_usd', 'contracts',
] as const;

const CONTEXT_COLS = ['atr', 'orb_range', 'orb_atr_ratio', 'exit_reason'] as const;

export interface CsvParseOptions {
  accountId?: string;
  symbol?: string;
}

function atrPercentile(atrValues: number[], target: number): number {
  if (atrValues.length === 0) return 50;
  const below = atrValues.filter(v => v <= target).length;
  return Math.round((below / atrValues.length) * 100);
}

// Minimal RFC 4180 lexer. Returns rows as string arrays.
// Handles quoted fields containing commas, escaped quotes (""), CRLF/LF line
// endings, and trailing newlines. Does NOT support multi-character delimiters.
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < input.length) {
    const c = input[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.length === 0) { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; i++; continue;
    }
    field += c; i++;
  }
  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

export function parseTradesCsv(csv: string, opts: CsvParseOptions = {}): Trade[] {
  const text = csv.trim();
  if (!text) throw new Error('Empty CSV');

  const allRows = parseCsvRows(text);
  if (allRows.length === 0) throw new Error('Empty CSV');
  const header = allRows[0]!.map((c) => c.trim());
  for (const req of REQUIRED_COLS) {
    if (!header.includes(req)) {
      throw new Error(`Missing required column: ${req}`);
    }
  }

  const idx = (name: string) => header.indexOf(name);
  const accountId = opts.accountId ?? 'T50_MNQ_BACKTEST';
  const symbol = opts.symbol ?? 'MNQ';
  const hasContext = CONTEXT_COLS.some(col => header.includes(col));
  const hasAtr = header.includes('atr');

  const dataRows = allRows.slice(1).filter(r => r.some(cell => cell.trim() !== ''));

  // Collect all ATR values first so we can compute per-trade percentile.
  const allAtrs: number[] = hasAtr
    ? dataRows.map(r => Number(r[idx('atr')])).filter(v => Number.isFinite(v) && v > 0)
    : [];

  return dataRows.map((cells, i) => {
    const date = cells[idx('date')]!.trim();
    const direction = cells[idx('direction')]!.trim().toLowerCase();
    if (direction !== 'long' && direction !== 'short') {
      throw new Error(`Row ${i + 2}: invalid direction "${direction}"`);
    }
    const qty = Number(cells[idx('contracts')]);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Row ${i + 2}: invalid contracts "${cells[idx('contracts')]}"`);
    }

    let context: Trade['context'];
    if (hasContext) {
      const atr = hasAtr ? Number(cells[idx('atr')]) : undefined;
      const validAtr = atr !== undefined && Number.isFinite(atr) && atr > 0 ? atr : undefined;
      context = {
        atr: validAtr,
        orb_range: header.includes('orb_range') ? Number(cells[idx('orb_range')]) || undefined : undefined,
        orb_atr_ratio: header.includes('orb_atr_ratio') ? Number(cells[idx('orb_atr_ratio')]) || undefined : undefined,
        exit_reason: header.includes('exit_reason') ? cells[idx('exit_reason')]?.trim() || undefined : undefined,
        atr_percentile: validAtr !== undefined ? atrPercentile(allAtrs, validAtr) : undefined,
      };
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
      context,
    } satisfies Trade;
  });
}
