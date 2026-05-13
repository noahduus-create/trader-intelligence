create table if not exists trader_intel.trades (
  id text primary key,
  account_id text not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  qty integer not null check (qty > 0),
  entry_price numeric not null,
  exit_price numeric not null,
  stop_price numeric,
  entry_at timestamptz not null,
  exit_at timestamptz not null,
  pnl_usd numeric not null,
  commission_usd numeric not null check (commission_usd >= 0),
  r_multiple numeric,
  created_at timestamptz default now()
);

create index if not exists idx_trades_account_entry
  on trader_intel.trades (account_id, entry_at desc);

alter table trader_intel.trades enable row level security;

create policy "service role only"
  on trader_intel.trades for all
  using (auth.role() = 'service_role');
