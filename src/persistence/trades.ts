import type { SupabaseClient } from '@supabase/supabase-js';
import type { Trade } from '../types.js';
import { computeRMultiple } from '../metrics/r-multiple.js';

export async function upsertTrades(
  client: SupabaseClient,
  trades: Trade[],
): Promise<void> {
  const rows = trades.map(t => ({
    ...t,
    r_multiple: computeRMultiple({
      side: t.side,
      entry: t.entry_price,
      exit: t.exit_price,
      stop: t.stop_price,
      qty: t.qty,
    }),
  }));

  const { error } = await client.from('trades').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`upsertTrades failed: ${error.message}`);
}
