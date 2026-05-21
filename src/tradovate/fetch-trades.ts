import { tradovateGet } from './client.js';
import type { Trade } from '../types.js';

interface Execution {
  id: number;
  accountId: number;
  orderId: number;
  timestamp: string;
  action: 'Buy' | 'Sell';
  qty: number;
  price: number;
  active: boolean;
  commission: number;
  symbol: string;
}

interface Fill {
  execId: number;
  qty: number;
  price: number;
  timestamp: string;
  commission: number;
}

interface OpenPosition {
  accountId: number;
  symbol: string;
  side: 'buy' | 'sell';
  openQty: number;
  entries: Fill[];
  exits: Fill[];
}

export interface FetchTradesInput {
  apiUrl: string;
  accessToken: string;
  accountId: number;
  from: string;
  to: string;
  fetchImpl?: typeof fetch;
}

export interface PairingResult {
  trades: Trade[];
  unclosedPositions: number;
}

export async function fetchTrades(input: FetchTradesInput): Promise<Trade[]> {
  const executions = await tradovateGet<Execution[]>(
    input,
    '/execution/list',
    {
      accountId: String(input.accountId),
      from: input.from,
      to: input.to,
    },
  );

  return pairExecutionsToTrades(executions);
}

export function pairExecutionsToTrades(execs: Execution[]): Trade[] {
  return pairExecutionsWithDiagnostics(execs).trades;
}

export function pairExecutionsWithDiagnostics(execs: Execution[]): PairingResult {
  const bySymbol = new Map<string, Execution[]>();
  for (const e of execs) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e);
    bySymbol.set(e.symbol, list);
  }

  const trades: Trade[] = [];
  let unclosed = 0;

  for (const [symbol, list] of bySymbol) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const { trades: symbolTrades, leftOpen } = pairForSymbol(symbol, list);
    trades.push(...symbolTrades);
    if (leftOpen) unclosed += 1;
  }

  return { trades, unclosedPositions: unclosed };
}

function pairForSymbol(symbol: string, execs: Execution[]): { trades: Trade[]; leftOpen: boolean } {
  const trades: Trade[] = [];
  let pos: OpenPosition | null = null;

  for (const exec of execs) {
    const execSide: 'buy' | 'sell' = exec.action === 'Buy' ? 'buy' : 'sell';
    const perUnitCommission = exec.qty > 0 ? exec.commission / exec.qty : 0;
    let remaining = exec.qty;

    while (remaining > 0) {
      if (pos === null) {
        pos = {
          accountId: exec.accountId,
          symbol,
          side: execSide,
          openQty: remaining,
          entries: [{
            execId: exec.id,
            qty: remaining,
            price: exec.price,
            timestamp: exec.timestamp,
            commission: perUnitCommission * remaining,
          }],
          exits: [],
        };
        remaining = 0;
      } else if (execSide === pos.side) {
        pos.entries.push({
          execId: exec.id,
          qty: remaining,
          price: exec.price,
          timestamp: exec.timestamp,
          commission: perUnitCommission * remaining,
        });
        pos.openQty += remaining;
        remaining = 0;
      } else {
        const closingQty = Math.min(remaining, pos.openQty);
        pos.exits.push({
          execId: exec.id,
          qty: closingQty,
          price: exec.price,
          timestamp: exec.timestamp,
          commission: perUnitCommission * closingQty,
        });
        pos.openQty -= closingQty;
        remaining -= closingQty;

        if (pos.openQty === 0) {
          trades.push(buildTrade(pos));
          pos = null;
        }
      }
    }
  }

  return { trades, leftOpen: pos !== null };
}

function buildTrade(pos: OpenPosition): Trade {
  const totalQty = pos.entries.reduce((s, f) => s + f.qty, 0);
  const weightedEntry = pos.entries.reduce((s, f) => s + f.qty * f.price, 0) / totalQty;
  const weightedExit = pos.exits.reduce((s, f) => s + f.qty * f.price, 0) / totalQty;
  const entryCommission = pos.entries.reduce((s, f) => s + f.commission, 0);
  const exitCommission = pos.exits.reduce((s, f) => s + f.commission, 0);

  const pnlPerUnit = pos.side === 'buy'
    ? weightedExit - weightedEntry
    : weightedEntry - weightedExit;
  const pnlUsd = pnlPerUnit * totalQty;

  const firstEntry = pos.entries[0]!;
  const lastEntry = pos.entries[pos.entries.length - 1]!;
  const firstExit = pos.exits[0]!;
  const lastExit = pos.exits[pos.exits.length - 1]!;

  const entrySpanSeconds = Math.max(0, Math.round((Date.parse(lastEntry.timestamp) - Date.parse(firstEntry.timestamp)) / 1000));
  const exitSpanSeconds = Math.max(0, Math.round((Date.parse(lastExit.timestamp) - Date.parse(firstExit.timestamp)) / 1000));
  const positionHeldSeconds = Math.max(0, Math.round((Date.parse(lastExit.timestamp) - Date.parse(firstEntry.timestamp)) / 1000));

  return {
    id: `tradovate-${firstEntry.execId}-${lastExit.execId}`,
    account_id: String(pos.accountId),
    symbol: pos.symbol,
    side: pos.side,
    qty: totalQty,
    entry_price: weightedEntry,
    exit_price: weightedExit,
    entry_at: firstEntry.timestamp,
    exit_at: lastExit.timestamp,
    pnl_usd: pnlUsd,
    commission_usd: entryCommission + exitCommission,
    execution_profile: {
      scale_in_count: pos.entries.length,
      scale_out_count: pos.exits.length,
      entry_span_seconds: entrySpanSeconds,
      exit_span_seconds: exitSpanSeconds,
      position_held_seconds: positionHeldSeconds,
    },
  };
}
