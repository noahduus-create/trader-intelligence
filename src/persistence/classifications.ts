import type { SupabaseClient } from '@supabase/supabase-js';
import type { Classification } from '../types.js';

export async function upsertClassifications(
  client: SupabaseClient,
  classifications: Classification[],
): Promise<void> {
  const { error } = await client
    .from('classifications')
    .upsert(classifications, { onConflict: 'trade_id' });
  if (error) throw new Error(`upsertClassifications failed: ${error.message}`);
}
