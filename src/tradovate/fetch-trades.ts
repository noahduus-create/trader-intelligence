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

export interface FetchTradesInput {
  apiUrl: string;
  accessToken: string;
  accountId: number;
  from: string;
  to: string;
  fetchImpl?: typeof fetch;
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
  const bySymbol = new Map<string, Execution[]>();
  for (const e of execs) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e);
    bySymbol.set(e.symbol, list);
  }

  const trades: Trade[] = [];
  for (const [symbol, list] of bySymbol) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    for (let i = 0; i + 1 < list.length; i += 2) {
      const entry = list[i]!;
      const exit = list[i + 1]!;
      const side = entry.action === 'Buy' ? 'buy' : 'sell';
      const pnlPerUnit = side === 'buy' ? exit.price - entry.price : entry.price - exit.price;
      const pnlUsd = pnlPerUnit * entry.qty;

      trades.push({
        id: `tradovate-${entry.id}-${exit.id}`,
        account_id: String(entry.accountId),
        symbol,
        side,
        qty: entry.qty,
        entry_price: entry.price,
        exit_price: exit.price,
        entry_at: entry.timestamp,
        exit_at: exit.timestamp,
        pnl_usd: pnlUsd,
        commission_usd: entry.commission + exit.commission,
      });
    }
  }

  return trades;
}
