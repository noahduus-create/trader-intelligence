-- Idempotent RLS posture for the cross-schema publish targets in public.*
-- (ti_runs + trade_classifications are created by the Mission Control project
-- and written to by TI's publishRun. The tables already have this policy in
-- the live MC_V2 Supabase project — this migration declares it for repeatability
-- so any fresh setup gets the same security posture.)

alter table if exists public.ti_runs enable row level security;
alter table if exists public.trade_classifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ti_runs'
      and policyname = 'Service role writes ti_runs'
  ) then
    create policy "Service role writes ti_runs" on public.ti_runs
      for all
      using (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trade_classifications'
      and policyname = 'Service role writes trade_classifications'
  ) then
    create policy "Service role writes trade_classifications" on public.trade_classifications
      for all
      using (auth.role() = 'service_role');
  end if;
end $$;
