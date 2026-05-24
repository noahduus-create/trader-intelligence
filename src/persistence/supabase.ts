import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Both clients use the SERVICE ROLE key — they bypass RLS.
// TI is the only writer to its own tables; there is no end-user
// surface here. Do not pass either client into a path that handles
// untrusted user input.

export function makeAdminClient(env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'trader_intel' },
  });
}

// Service-role client scoped at the `public` schema for cross-schema writes
// to the Mission Control publish targets (public.ti_runs, public.trade_classifications).
// Despite being named for the schema it targets, this is NOT a low-privilege
// public-facing client — it bypasses RLS like makeAdminClient does.
export function makeMcServiceClient(env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
