create table if not exists trader_intel.classifications (
  trade_id text primary key references trader_intel.trades(id) on delete cascade,
  setup text not null,
  time_of_day text not null,
  quality text not null,
  mistakes text[] not null default '{}',
  notes text not null,
  classified_at timestamptz default now()
);

create index if not exists idx_classifications_setup
  on trader_intel.classifications (setup);

alter table trader_intel.classifications enable row level security;

create policy "service role only"
  on trader_intel.classifications for all
  using (auth.role() = 'service_role');
