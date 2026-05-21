import type { SupabaseClient } from '@supabase/supabase-js';
import type { Classification } from '../types.js';

export async function upsertClassifications(
  client: SupabaseClient,
  classifications: Classification[],
): Promise<void> {
  const rows = classifications.map(c => ({
    trade_id: c.trade_id,
    reasoning: c.reasoning,
    setup: c.setup,
    time_of_day: c.time_of_day,
    quality: c.quality,
    entry_mistakes: c.entry_mistakes,
    management_mistakes: c.management_mistakes,
    notes: c.notes,
  }));
  const { error } = await client
    .from('classifications')
    .upsert(rows, { onConflict: 'trade_id' });
  if (error) throw new Error(`upsertClassifications failed: ${error.message}`);
}
